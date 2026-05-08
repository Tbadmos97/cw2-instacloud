# CW2 InstaCloud — React + Azure coursework starter

This folder is a cloud-deployable starter for COM769 Coursework 2. It is intentionally written so you can deploy it without running anything on your laptop.

## What it includes

- React/Vite Instagram-style frontend.
- Azure Static Web Apps hosting.
- Azure Functions REST API under `/api`.
- Azure Blob Storage for image files.
- Azure Cosmos DB for photo metadata, comments and ratings.
- Azure Static Web Apps authentication and role-based behaviour:
  - viewer/consumer: view, search, comment and rate.
  - creator: all viewer actions plus upload.

## Important academic note

Personalise the project before submission. Change the styling, wording, feature details, architecture explanation and demo evidence. Your university coursework declaration requires that AI help is acknowledged where used.

## Cloud-only deployment overview

You will use:

1. GitHub in the browser for the repository.
2. Azure Portal for all Azure resources.
3. Azure Static Web Apps GitHub Actions build/deploy, created automatically by Azure.

You do not need to run `npm install` or `npm start` locally.

## Repository upload from browser

1. Go to https://github.com and sign in.
2. Create a new public or private repository, for example `cw2-instacloud`.
3. Upload all files and folders from this project into the repository.
   - Use **Add file > Upload files**.
   - Keep the folder structure exactly the same.
4. Commit to the `main` branch.

## Azure resources to create

Use one resource group, for example `rg-cw2-instacloud`.

### 1. Azure Storage Account

1. Azure Portal > search **Storage accounts** > **Create**.
2. Resource group: `rg-cw2-instacloud`.
3. Name: globally unique, lowercase, for example `cw2media12345`.
4. Region: near you, for example UK South.
5. Performance: Standard.
6. Redundancy: LRS for a low-cost demo.
7. Create.
8. Open the storage account > **Data storage > Containers** > **+ Container**.
9. Name: `media`.
10. Public access level: Private.
11. Open **Security + networking > Access keys** and copy a connection string.

### 2. Azure Cosmos DB for NoSQL

1. Azure Portal > search **Azure Cosmos DB** > **Create**.
2. Choose **Azure Cosmos DB for NoSQL**.
3. Resource group: `rg-cw2-instacloud`.
4. Account name: globally unique, for example `cw2-insta-cosmos-12345`.
5. Capacity mode: Serverless if available.
6. Apply Free Tier Discount if your subscription allows it.
7. Region: same or near the storage region.
8. Create.
9. Open the Cosmos account > **Keys**.
10. Copy the URI/Endpoint and Primary Key.

The API creates the database/container automatically on the first successful request:

- Database: `instacloud`
- Container: `posts`
- Partition key: `/pk`

### 3. Azure Static Web App

1. Azure Portal > search **Static Web Apps** > **Create**.
2. Subscription and resource group: use the same group.
3. Name: for example `cw2-instacloud-yourstudentnumber`.
4. Plan type: Free is enough for a coursework demo.
5. Region for Azure Functions/API: choose the closest available region.
6. Deployment source: GitHub.
7. Sign in to GitHub and select your repository and branch `main`.
8. Build details:
   - Build preset: React
   - App location: `/`
   - API location: `api`
   - Output location: `dist`
9. Create.
10. Wait for the GitHub Actions deployment to finish.

### 4. Add Static Web App configuration values

Open your Static Web App > **Settings > Configuration** and add these application settings:

| Name | Value |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Storage account connection string |
| `BLOB_CONTAINER_NAME` | `media` |
| `COSMOS_ENDPOINT` | Cosmos DB URI/Endpoint |
| `COSMOS_KEY` | Cosmos DB Primary Key |
| `COSMOS_DATABASE` | `instacloud` |
| `COSMOS_CONTAINER` | `posts` |

Save the settings, then go to your GitHub repository > **Actions** > rerun the latest Static Web Apps workflow if needed.

### 5. Assign the creator role

1. Open Azure Portal > your Static Web App.
2. Go to **Settings > Role Management**.
3. Select **Invite**.
4. Choose the identity provider you will use, for example GitHub.
5. Enter the creator user's GitHub username or email, depending on the provider.
6. In roles, add: `creator`.
7. Generate the invite link.
8. Open the invite link in the creator user's browser and accept it.

Any signed-in account without this custom `creator` role is treated as a viewer.

## Test plan for your demo video

1. Open the Static Web Apps URL.
2. Sign in as a viewer.
3. Show the viewer feed, search box, comment and rating features.
4. Try creator studio as viewer and show upload is blocked.
5. Sign out.
6. Sign in as creator using the invited role account.
7. Upload an image with title, caption, location and people metadata.
8. Show the image appears in the feed.
9. In Azure Portal, show:
   - Static Web Apps deployment and GitHub Actions.
   - Storage account container `media` with the uploaded blob.
   - Cosmos DB Data Explorer showing the post document, comments and ratings.
10. Explain scalability: static edge hosting, serverless REST API, blob object storage, Cosmos DB, authentication/roles and CI/CD.

## Useful file map

```text
cw2-instacloud/
├── src/                         React frontend
├── api/src/functions/            Azure Functions REST endpoints
├── api/src/shared.js             shared Cosmos/Blob/auth helper code
├── staticwebapp.config.json      Static Web Apps routing/auth configuration
├── package.json                  frontend build config
└── README.md                     cloud-only deployment guide
```

## API endpoints

- `GET /api/me` — returns signed-in user and roles.
- `GET /api/posts?q=searchTerm` — lists/searches posts.
- `POST /api/upload` — creator-only upload, enforced in the API.
- `POST /api/comments` — viewer/creator comments.
- `POST /api/ratings` — viewer/creator rating.

## Known limitations to discuss in slides

- Demo upload limit is 5 MB to avoid free-tier and request-size issues.
- Comments and ratings are embedded in the post document for simplicity; a production version should use separate containers or better partitioning for high write volume.
- Image processing/cognitive analysis is not enabled by default to avoid cost; it can be added with Azure AI Vision.
- Blob SAS URLs are generated for one hour, which is good for private access but adds API dependency.
- The sample uses account keys in app settings for simplicity; production should prefer managed identities and role-based access.
