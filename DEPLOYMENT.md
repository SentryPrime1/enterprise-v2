# SentryPrime v3 - Google Cloud Run Deployment Guide

## Prerequisites

1. **Google Cloud Project** with billing enabled
2. **gcloud CLI** installed and configured
3. **Cloud SQL PostgreSQL instance** created
4. **OpenAI API Key**

## Step 1: Set Up Cloud SQL Database

### Create Cloud SQL Instance

```bash
gcloud sql instances create sentryprime-db \
  --database-version=POSTGRES_14 \
  --tier=db-f1-micro \
  --region=us-central1
```

### Set Root Password

```bash
gcloud sql users set-password postgres \
  --instance=sentryprime-db \
  --password=YOUR_SECURE_PASSWORD
```

### Create Database

```bash
gcloud sql databases create sentryprime \
  --instance=sentryprime-db
```

### Run Database Migrations

Connect to your Cloud SQL instance and run the schema:

```bash
# Using Cloud SQL Proxy
gcloud sql connect sentryprime-db --user=postgres --database=sentryprime < database_schema.sql
```

Or use the Cloud Console SQL Editor to paste the contents of `database_schema.sql`.

## Step 2: Configure Environment Variables

Create a `.env.production` file (do NOT commit this):

```bash
# Database Configuration (Cloud SQL)
DB_HOST=your-project:us-central1:sentryprime-db
DB_USER=postgres
DB_PASSWORD=your-secure-password
DB_NAME=sentryprime

# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-key

# NextAuth Configuration
NEXTAUTH_URL=https://your-service-url.run.app
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32

# Feature Flags
ENABLE_DEPLOYMENT_FEATURES=true

# Environment
NODE_ENV=production
PORT=8080
```

## Step 3: Build and Deploy to Cloud Run

### Option A: Deploy with Source (Recommended)

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Deploy to Cloud Run
gcloud run deploy sentryprime-v3 \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --timeout 300 \
  --max-instances 10 \
  --concurrency 80 \
  --cpu 2 \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "DB_HOST=YOUR_PROJECT:us-central1:sentryprime-db" \
  --set-env-vars "DB_USER=postgres" \
  --set-env-vars "DB_NAME=sentryprime" \
  --set-env-vars "ENABLE_DEPLOYMENT_FEATURES=true" \
  --set-env-vars "NEXTAUTH_URL=https://sentryprime-v3-YOUR_HASH.run.app" \
  --set-secrets "DB_PASSWORD=db-password:latest" \
  --set-secrets "OPENAI_API_KEY=openai-key:latest" \
  --set-secrets "NEXTAUTH_SECRET=nextauth-secret:latest" \
  --add-cloudsql-instances YOUR_PROJECT:us-central1:sentryprime-db
```

### Option B: Deploy with Docker

```bash
# Build Docker image
docker build -t gcr.io/YOUR_PROJECT_ID/sentryprime-v3 .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/sentryprime-v3

# Deploy to Cloud Run
gcloud run deploy sentryprime-v3 \
  --image gcr.io/YOUR_PROJECT_ID/sentryprime-v3 \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --timeout 300 \
  --max-instances 10 \
  --concurrency 80 \
  --cpu 2 \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "DB_HOST=YOUR_PROJECT:us-central1:sentryprime-db" \
  --set-env-vars "DB_USER=postgres" \
  --set-env-vars "DB_NAME=sentryprime" \
  --set-env-vars "ENABLE_DEPLOYMENT_FEATURES=true" \
  --set-env-vars "NEXTAUTH_URL=https://sentryprime-v3-YOUR_HASH.run.app" \
  --set-secrets "DB_PASSWORD=db-password:latest" \
  --set-secrets "OPENAI_API_KEY=openai-key:latest" \
  --set-secrets "NEXTAUTH_SECRET=nextauth-secret:latest" \
  --add-cloudsql-instances YOUR_PROJECT:us-central1:sentryprime-db
```

## Step 4: Set Up Secrets in Google Secret Manager

```bash
# Create database password secret
echo -n "your-db-password" | gcloud secrets create db-password --data-file=-

# Create OpenAI API key secret
echo -n "sk-your-openai-key" | gcloud secrets create openai-key --data-file=-

# Generate and create NextAuth secret
openssl rand -base64 32 | gcloud secrets create nextauth-secret --data-file=-

# Grant Cloud Run access to secrets
gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding openai-key \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding nextauth-secret \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Step 5: Update NEXTAUTH_URL

After deployment, get your service URL:

```bash
gcloud run services describe sentryprime-v3 --region us-central1 --format="value(status.url)"
```

Update the service with the correct NEXTAUTH_URL:

```bash
gcloud run services update sentryprime-v3 \
  --region us-central1 \
  --set-env-vars "NEXTAUTH_URL=https://your-actual-service-url.run.app"
```

## Step 6: Verify Deployment

1. Visit your Cloud Run service URL
2. You should see the login page
3. Create a new account via the signup page
4. Test the scanning functionality

## Troubleshooting

### Database Connection Issues

Check logs:
```bash
gcloud run services logs read sentryprime-v3 --region us-central1 --limit 50
```

Verify Cloud SQL connection:
```bash
gcloud run services describe sentryprime-v3 --region us-central1 --format="value(spec.template.spec.containers[0].env)"
```

### Puppeteer/Chrome Issues

If scans fail, check that Chrome is properly installed in the container:

```bash
# View container logs
gcloud run services logs read sentryprime-v3 --region us-central1 | grep -i chrome
```

### Memory Issues

If you see out-of-memory errors, increase memory:

```bash
gcloud run services update sentryprime-v3 \
  --region us-central1 \
  --memory 4Gi
```

## Continuous Deployment

### Set Up GitHub Actions (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - id: auth
        uses: google-github-actions/auth@v1
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v1
        with:
          service: sentryprime-v3
          region: us-central1
          source: .
```

## Cost Optimization

1. **Use Cloud SQL Proxy** for local development instead of public IP
2. **Set max instances** to control costs
3. **Use minimum instances: 0** to scale to zero when not in use
4. **Monitor usage** in Cloud Console

## Security Best Practices

1. ✅ Use Secret Manager for sensitive data
2. ✅ Enable Cloud SQL SSL connections
3. ✅ Use IAM for access control
4. ✅ Enable Cloud Armor for DDoS protection (optional)
5. ✅ Set up Cloud Monitoring alerts

## Monitoring

Set up monitoring:

```bash
# View metrics
gcloud run services describe sentryprime-v3 --region us-central1

# Set up alerts (via Cloud Console)
# - CPU utilization > 80%
# - Memory utilization > 80%
# - Request latency > 5s
# - Error rate > 1%
```

## Rollback

If deployment fails:

```bash
# List revisions
gcloud run revisions list --service sentryprime-v3 --region us-central1

# Rollback to previous revision
gcloud run services update-traffic sentryprime-v3 \
  --region us-central1 \
  --to-revisions REVISION_NAME=100
```

## Support

For issues, check:
1. Cloud Run logs
2. Cloud SQL logs
3. Application logs in Cloud Logging

---

**Deployment Complete!** 🎉

Your SentryPrime application should now be live at:
`https://sentryprime-v3-XXXXX-uc.a.run.app`

