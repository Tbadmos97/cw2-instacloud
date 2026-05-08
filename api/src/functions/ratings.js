const { app } = require('@azure/functions');
const {
  getClientPrincipal,
  assertAuthenticated,
  getCosmosContainer,
  safeString,
  readJson,
  jsonResponse,
  errorResponse,
  publicPost
} = require('../shared');

app.http('ratings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ratings',
  handler: async (request) => {
    try {
      const principal = getClientPrincipal(request);
      assertAuthenticated(principal);

      const body = await readJson(request);
      const postId = safeString(body.postId, 100);
      const rating = Number(body.rating);
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

      return jsonResponse({ post: publicPost(post, principal) });
    } catch (error) {
      return errorResponse(error);
    }
  }
});
