const { app } = require('@azure/functions');
const {
  getClientPrincipal,
  assertAuthenticated,
  getCosmosContainer,
  jsonResponse,
  errorResponse,
  publicPost
} = require('../shared');

app.http('posts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'posts',
  handler: async (request) => {
    try {
      const principal = getClientPrincipal(request);
      assertAuthenticated(principal);

      const q = (request.query.get('q') || '').toLowerCase().trim();
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

      return jsonResponse({ posts: filtered.map((post) => publicPost(post, principal)) });
    } catch (error) {
      return errorResponse(error);
    }
  }
});
