const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { CosmosClient } = require('@azure/cosmos');
const {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} = require('@azure/storage-blob');

const app = express();
const port = process.env.PORT || 8080;
const distPath = path.join(__dirname, 'dist');

app.use(express.json({ limit: '7mb' }));

let cosmosContainer;
let blobContainer;
let storageCredential;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required application setting: ${name}`);
  return value;
}

function parseConnectionString(connectionString) {
  return connectionString.split(';').reduce((parts, section) => {
    const index = section.indexOf('=');
    if (index > 0) parts[section.slice(0, index)] = section.slice(index + 1);
    return parts;
  }, {});
}

function getStorageCredential() {
  if (storageCredential) return storageCredential;
  const parts = parseConnectionString(required('AZURE_STORAGE_CONNECTION_STRING'));
  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING must include AccountName and AccountKey.');
  }
  storageCredential = new StorageSharedKeyCredential(parts.AccountName, parts.AccountKey);
  return storageCredential;
}

async function getBlobContainer() {
  if (blobContainer) return blobContainer;
  const serviceClient = BlobServiceClient.fromConnectionString(required('AZURE_STORAGE_CONNECTION_STRING'));
  const containerName = process.env.BLOB_CONTAINER_NAME || 'media';
  const containerClient = serviceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists();
  blobContainer = containerClient;
  return blobContainer;
}

async function getCosmosContainer() {
  if (cosmosContainer) return cosmosContainer;
  const client = new CosmosClient({
    endpoint: required('COSMOS_ENDPOINT'),
    key: required('COSMOS_KEY')
  });
  const databaseId = process.env.COSMOS_DATABASE || 'instacloud';
  const containerId = process.env.COSMOS_CONTAINER || 'posts';
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  const { container } = await database.containers.createIfNotExists({
    id: containerId,
    partitionKey: { paths: ['/pk'] }
  });
  cosmosContainer = container;
  return cosmosContainer;
}

function claimValue(claims, endings) {
  if (!Array.isArray(claims)) return '';
  const wanted = Array.isArray(endings) ? endings : [endings];
  const found = claims.find((claim) => wanted.some((ending) => String(claim.typ || claim.type || '').toLowerCase().endsWith(ending.toLowerCase())));
  return found ? String(found.val || found.value || '') : '';
}

function decodePrincipalHeader(headerValue) {
  if (!headerValue) return null;
  try {
    return JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function creatorList() {
  return String(process.env.CREATOR_EMAILS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function getClientPrincipal(req) {
  const demoMode = String(process.env.DEMO_MODE || '').toLowerCase();
  if (demoMode === 'viewer' || demoMode === 'creator') {
    return {
      userId: `demo-${demoMode}`,
      userDetails: demoMode === 'creator' ? 'Demo Creator' : 'Demo Viewer',
      identityProvider: 'demo',
      userRoles: demoMode === 'creator' ? ['authenticated', 'creator'] : ['authenticated']
    };
  }

  const decoded = decodePrincipalHeader(req.get('x-ms-client-principal'));
  if (!decoded) {
    return { userId: 'anonymous', userDetails: 'Anonymous', identityProvider: 'none', userRoles: ['anonymous'] };
  }

  // Supports both Static Web Apps-style headers and App Service Authentication / Easy Auth claim headers.
  const claims = decoded.claims || [];
  const email = decoded.userDetails
    || claimValue(claims, ['preferred_username', 'emailaddress', 'email', 'upn'])
    || '';
  const displayName = decoded.userDetails
    || claimValue(claims, ['name'])
    || email
    || decoded.userId
    || 'Signed-in user';
  const userId = decoded.userId
    || claimValue(claims, ['nameidentifier', 'oid', 'sub'])
    || email
    || displayName;

  const roles = new Set(Array.isArray(decoded.userRoles) ? decoded.userRoles : []);
  roles.add('authenticated');

  const normalized = [email, displayName, userId].map((x) => String(x || '').toLowerCase());
  if (creatorList().some((allowed) => normalized.includes(allowed))) {
    roles.add('creator');
  }

  return {
    userId,
    userDetails: displayName,
    identityProvider: decoded.identityProvider || decoded.auth_typ || 'azure-app-service-auth',
    userRoles: Array.from(roles)
  };
}

function hasRole(principal, role) {
  return Array.isArray(principal.userRoles) && principal.userRoles.includes(role);
}

function assertAuthenticated(principal) {
  if (!hasRole(principal, 'authenticated') && !hasRole(principal, 'creator')) {
    const error = new Error('Please sign in first.');
    error.status = 401;
    throw error;
  }
}

function assertCreator(principal) {
  assertAuthenticated(principal);
  if (!hasRole(principal, 'creator')) {
    const error = new Error('Only creator accounts can upload content.');
    error.status = 403;
    throw error;
  }
}

function safeString(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function sanitizeFileName(name) {
  const cleaned = safeString(name || 'upload.jpg', 120).replace(/[^a-zA-Z0-9._-]/g, '-');
  return cleaned || 'upload.jpg';
}

function buildReadSasUrl(blobName) {
  const containerName = process.env.BLOB_CONTAINER_NAME || 'media';
  const credential = getStorageCredential();
  const containerClient = BlobServiceClient
    .fromConnectionString(required('AZURE_STORAGE_CONNECTION_STRING'))
    .getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);

  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + 60 * 60 * 1000);
  const sas = generateBlobSASQueryParameters({
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    startsOn,
    expiresOn
  }, credential).toString();

  return `${blobClient.url}?${sas}`;
}

function publicPost(post, principal) {
  const ratings = post.ratings || {};
  const values = Object.values(ratings).map(Number).filter((n) => Number.isFinite(n));
  const avgRating = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    id: post.id,
    title: post.title,
    caption: post.caption,
    location: post.location,
    people: post.people,
    createdAt: post.createdAt,
    createdByName: post.createdByName,
    imageUrl: buildReadSasUrl(post.blobName),
    comments: post.comments || [],
    avgRating,
    ratingCount: values.length,
    myRating: ratings[principal.userId] || 0
  };
}

function sendError(res, error) {
  const status = error.status || 500;
  const message = status === 500 ? 'Server error. Check Azure App Service logs and application settings.' : error.message;
  res.status(status).json({ error: message });
}

app.get('/api/me', (req, res) => {
  try {
    const principal = getClientPrincipal(req);
    assertAuthenticated(principal);
    res.json({
      userId: principal.userId,
      displayName: principal.userDetails,
      identityProvider: principal.identityProvider,
      roles: principal.userRoles,
      isCreator: hasRole(principal, 'creator')
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const principal = getClientPrincipal(req);
    assertAuthenticated(principal);
    const q = safeString(req.query.q, 200).toLowerCase();
    const container = await getCosmosContainer();
    const { resources } = await container.items.query({
      query: 'SELECT * FROM c WHERE c.pk = @pk AND c.type = @type ORDER BY c.createdAt DESC',
      parameters: [
        { name: '@pk', value: 'post' },
        { name: '@type', value: 'post' }
      ]
    }, { partitionKey: 'post' }).fetchAll();

    const filtered = q
      ? resources.filter((post) => `${post.title} ${post.caption} ${post.location} ${post.people}`.toLowerCase().includes(q))
      : resources;
    res.json({ posts: filtered.map((post) => publicPost(post, principal)) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/upload', async (req, res) => {
  try {
    const principal = getClientPrincipal(req);
    assertCreator(principal);
    const body = req.body || {};
    const title = safeString(body.title, 120);
    const caption = safeString(body.caption, 1000);
    const location = safeString(body.location, 120);
    const people = safeString(body.people, 200);
    const fileName = sanitizeFileName(body.fileName);
    const contentType = safeString(body.contentType, 100) || 'image/jpeg';
    const imageDataUrl = String(body.imageDataUrl || '');

    if (!title || !caption) {
      const error = new Error('Title and caption are required.');
      error.status = 400;
      throw error;
    }
    if (!contentType.startsWith('image/')) {
      const error = new Error('Only image uploads are supported.');
      error.status = 400;
      throw error;
    }
    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      const error = new Error('imageDataUrl must be a base64 data URL.');
      error.status = 400;
      throw error;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      const error = new Error('Maximum demo upload size is 5 MB.');
      error.status = 400;
      throw error;
    }

    const id = makeId();
    const blobName = `${id}-${fileName}`;
    const blobContainerClient = await getBlobContainer();
    const blockBlob = blobContainerClient.getBlockBlobClient(blobName);
    await blockBlob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });

    const post = {
      id,
      pk: 'post',
      type: 'post',
      title,
      caption,
      location,
      people,
      blobName,
      contentType,
      createdAt: new Date().toISOString(),
      createdBy: principal.userId,
      createdByName: principal.userDetails,
      comments: [],
      ratings: {}
    };

    const container = await getCosmosContainer();
    await container.items.create(post);
    res.status(201).json({ post: publicPost(post, principal) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    const principal = getClientPrincipal(req);
    assertAuthenticated(principal);
    const postId = safeString(req.body.postId, 100);
    const text = safeString(req.body.text, 500);
    if (!postId || !text) {
      const error = new Error('postId and text are required.');
      error.status = 400;
      throw error;
    }

    const container = await getCosmosContainer();
    const { resource: post } = await container.item(postId, 'post').read();
    if (!post) {
      const error = new Error('Post not found.');
      error.status = 404;
      throw error;
    }

    post.comments = post.comments || [];
    post.comments.push({
      id: makeId(),
      text,
      authorId: principal.userId,
      authorName: principal.userDetails,
      createdAt: new Date().toISOString()
    });

    await container.item(postId, 'post').replace(post);
    res.json({ post: publicPost(post, principal) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/ratings', async (req, res) => {
  try {
    const principal = getClientPrincipal(req);
    assertAuthenticated(principal);
    const postId = safeString(req.body.postId, 100);
    const rating = Number(req.body.rating);
    if (!postId || !Number.isFinite(rating) || rating < 1 || rating > 5) {
      const error = new Error('postId and rating between 1 and 5 are required.');
      error.status = 400;
      throw error;
    }

    const container = await getCosmosContainer();
    const { resource: post } = await container.item(postId, 'post').read();
    if (!post) {
      const error = new Error('Post not found.');
      error.status = 404;
      throw error;
    }

    post.ratings = post.ratings || {};
    post.ratings[principal.userId] = rating;
    await container.item(postId, 'post').replace(post);
    res.json({ post: publicPost(post, principal) });
  } catch (error) {
    sendError(res, error);
  }
});

app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`InstaCloud App Service server listening on port ${port}`);
});
