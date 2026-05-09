# Azure App Service deployment notes

This version deploys the React frontend and REST API together as one Node/Express Azure App Service.

Azure services used:
- Azure App Service: hosts React build and REST API routes under /api
- Azure Blob Storage: stores uploaded photos
- Azure Cosmos DB for NoSQL: stores post metadata, comments, and ratings
- Azure App Service Authentication: signs users in and passes identity headers to the app

Required App Service application settings:
- AZURE_STORAGE_CONNECTION_STRING
- BLOB_CONTAINER_NAME = media
- COSMOS_ENDPOINT
- COSMOS_KEY
- COSMOS_DATABASE = instacloud
- COSMOS_CONTAINER = posts
- CREATOR_EMAILS = comma-separated creator emails/usernames

Startup command:
- npm start
