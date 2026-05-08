const { app } = require('@azure/functions');
const { getClientPrincipal, hasRole, jsonResponse } = require('../shared');

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: async (request) => {
    const principal = getClientPrincipal(request);
    return jsonResponse({
      userId: principal.userId,
      displayName: principal.userDetails,
      identityProvider: principal.identityProvider,
      roles: principal.userRoles,
      isCreator: hasRole(principal, 'creator')
    });
  }
});
