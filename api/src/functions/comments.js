const { app } = require('@azure/functions');
const {
  getClientPrincipal,
  assertAuthenticated,
  getCosmosContainer,
  safeString,
  makeId,
  readJson,
  jsonResponse,
  errorResponse,
  publicPost
} = require('../shared');

app.http('comments', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'comments',
  handler: async (request) => {
    try {
      const principal = getClientPrincipal(request);
      assertAuthenticated(principal);

      const body = await readJson(request);
      const postId = safeString(body.postId, 100);
      const text = safeString(body.text, 500);
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
      return jsonResponse({ post: publicPost(post, principal) });
    } catch (error) {
      return errorResponse(error);
    }
  }
});
