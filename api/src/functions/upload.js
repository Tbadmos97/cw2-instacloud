const { app } = require('@azure/functions');
const {
  getClientPrincipal,
  assertCreator,
  getCosmosContainer,
  getBlobContainer,
  safeString,
  makeId,
  sanitizeFileName,
  readJson,
  jsonResponse,
  errorResponse,
  publicPost
} = require('../shared');

app.http('upload', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'upload',
  handler: async (request) => {
    try {
      const principal = getClientPrincipal(request);
      assertCreator(principal);

      const body = await readJson(request);
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
      const blobContainer = await getBlobContainer();
      const blockBlob = blobContainer.getBlockBlobClient(blobName);
      await blockBlob.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: contentType }
      });

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

      return jsonResponse({ post: publicPost(post, principal) }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  }
});
