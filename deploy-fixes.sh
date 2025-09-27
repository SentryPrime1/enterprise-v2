#!/bin/bash

echo "🚀 Deploying SentryPrime Scanner fixes..."

# Build the container
echo "📦 Building container..."
gcloud builds submit --tag gcr.io/sentryprime/sentryprime-scanner .

# Deploy to Cloud Run with all environment variables
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy sentryprime-scanner \
  --image gcr.io/sentryprime/sentryprime-scanner \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --set-env-vars NODE_ENV=production,DB_HOST=sentryprime.us-central1:sentryprime-db,DB_USER=sentryprime_app,DB_PASSWORD=Clutch42512!,DB_NAME=postgres,OPENAI_API_KEY=sk-proj-HBOkJgB5wgYwekb2ir_JZUN03MweXJeS

echo "✅ Deployment complete!"
echo "🌐 Your scanner should now have:"
echo "   - AI checkbox visible and working"
echo "   - No auto-redirect after scans"
echo "   - Results stay visible until you navigate away"
