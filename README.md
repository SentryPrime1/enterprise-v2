# 🛡️ SentryPrime v3 - Enterprise Accessibility Compliance Platform

**Modern Next.js rebuild with TypeScript, Tailwind CSS, and full Google Cloud Run support**

## 🎯 Overview

SentryPrime is an automated accessibility compliance platform that scans websites for WCAG violations and provides AI-powered fixes with one-click deployment to WordPress, Shopify, and custom sites.

### What's New in v3

- ✅ **Modern Tech Stack**: Next.js 16, TypeScript, Tailwind CSS
- ✅ **Authentication**: NextAuth.js with email/password
- ✅ **Better UX**: Professional dashboard with real-time updates
- ✅ **Type Safety**: Full TypeScript coverage
- ✅ **Cloud Ready**: Optimized for Google Cloud Run

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Set up database
createdb sentryprime_dev
psql sentryprime_dev < database_schema.sql

# Configure environment (copy .env.local and update values)
cp .env.local .env.local.example

# Run development server
pnpm dev
```

Visit http://localhost:3000

## 📚 Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide for Google Cloud Run
- **[Database Schema](./database_schema.sql)** - PostgreSQL schema

## 🚢 Deploy to Google Cloud Run

```bash
gcloud run deploy sentryprime-v3 \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --add-cloudsql-instances YOUR_PROJECT:us-central1:sentryprime-db
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

## 📄 License

MIT License
