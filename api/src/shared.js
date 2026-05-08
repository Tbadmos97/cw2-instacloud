const { CosmosClient } = require('@azure/cosmos');
const {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} = require('@azure/storage-blob');
const crypto = require('crypto');

let cosmosContainer;
let blobContainer;
let storageCredential;

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required application setting: ${name}`);
  return value;
};

function getClientPrincipal(request) {
  const encoded = request.headers.get('x-ms-client-principal');
  if (!encoded) {
    return { userId: 'anonymous', userDetails: 'Anonymous', userRoles: ['anonymous'] };
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const principal = JSON.parse(decoded);
    return {
      userId: principal.userId || 'unknown-user',
      userDetails: principal.userDetails || principal.userId || 'Signed-in user',
      identityProvider: principal.identityProvider,
      userRoles: principal.userRoles || []
    };
  } catch {
    return { userId: 'unknown-user', userDetails: 'Signed-in user', userRoles: [] };
  }
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

  const connectionString = required('AZURE_STORAGE_CONNECTION_STRING');
  const containerName = process.env.BLOB_CONTAINER_NAME || 'media';
  const serviceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = serviceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists();
  blobContainer = containerClient;
  return blobContainer;
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

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    jsonBody: body
  };
}

function errorResponse(error) {
  const status = error.status || 500;
  const message = status === 500 ? 'Server error. Check Azure Function logs and application settings.' : error.message;
  return jsonResponse({ error: message }, status);
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

module.exports = {
  getClientPrincipal,
  hasRole,
  assertAuthenticated,
  assertCreator,
  getCosmosContainer,
  getBlobContainer,
  buildReadSasUrl,
  safeString,
  makeId,
  sanitizeFileName,
  readJson,
  jsonResponse,
  errorResponse,
  publicPost
};
