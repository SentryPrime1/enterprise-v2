# 🛡️ SentryPrime Enterprise Dashboard

Professional accessibility scanner with enterprise dashboard interface, powered by Puppeteer and axe-core.

## ✨ Features

- **Professional Dashboard UI** - Modern enterprise interface with sidebar navigation
- **Single Page Scanning** - Fast accessibility analysis (30-90 seconds)
- **Multi-Page Crawling** - Comprehensive site scanning (up to 20 pages)
- **Real-time Results** - Live scan progress and detailed reports
- **Enterprise Ready** - Scalable, containerized deployment

## 🚀 Quick Start

### Local Development

```bash
# Clone the repository
git clone <your-repo-url>
cd enterprise-v2

# Install dependencies
npm install

# Start the server
npm start
```

Visit `http://localhost:8080` to access the dashboard.

### Docker Deployment

```bash
# Build the image
docker build -t sentryprime-enterprise .

# Run the container
docker run -p 8080:8080 sentryprime-enterprise
```

### Google Cloud Run Deployment

```bash
# Deploy to Cloud Run
gcloud run deploy sentryprime-enterprise \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --timeout 300
```

## 📋 API Endpoints

### Health Check
```
GET /health
```
Returns server health status and timestamp.

### Accessibility Scan
```
POST /api/scan
Content-Type: application/json

{
  "url": "https://example.com",
  "scanType": "single|crawl",
  "maxPages": 5
}
```

## 🎯 Dashboard Features

### Navigation Sidebar
- **Dashboard** - Overview and metrics
- **Scans** - Active scanning interface (current page)
- **Analytics** - Scan history and trends
- **Team** - User management
- **Integrations** - Third-party connections
- **API Management** - API keys and settings
- **Billing** - Subscription management
- **Settings** - Configuration options

### Scan Interface
- **New Scan Button** - Toggle scan form visibility
- **Scan Options** - Choose between single page or multi-page crawling
- **Real-time Results** - Live progress updates and detailed violation reports
- **Recent Scans** - Sample history of previous scans

## 🔧 Configuration

### Environment Variables

- `PORT` - Server port (default: 8080)
- `NODE_ENV` - Environment (development/production)

### Scan Limits

- **Single Page Timeout** - 90 seconds
- **Multi-Page Timeout** - 5 minutes per crawl
- **Maximum Pages** - 20 pages per crawl session
- **Memory Limit** - 2GB recommended for Cloud Run

## 🛠️ Technical Stack

- **Backend** - Node.js 18+ with Express
- **Scanner Engine** - Puppeteer 23.5.0 + axe-core 4.10.0
- **Frontend** - Vanilla HTML/CSS/JavaScript (no frameworks)
- **Container** - Docker with Google Chrome Stable
- **Deployment** - Google Cloud Run optimized

## 📊 API Response Examples

### Single Page Scan Response
```json
{
  "success": true,
  "url": "https://example.com",
  "violations": [
    {
      "id": "color-contrast",
      "impact": "serious",
      "description": "Elements must have sufficient color contrast",
      "help": "Ensure all text elements have sufficient color contrast",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/color-contrast"
    }
  ],
  "timestamp": "2024-09-25T21:30:00.000Z",
  "totalIssues": 5,
  "scanTime": 1234,
  "summary": {
    "critical": 1,
    "serious": 2,
    "moderate": 1,
    "minor": 1
  }
}
```

### Multi-Page Crawl Response
```json
{
  "success": true,
  "scanType": "crawl",
  "pages": [
    {
      "url": "https://example.com",
      "violations": [...],
      "scanTime": 1234
    },
    {
      "url": "https://example.com/about",
      "violations": [...],
      "scanTime": 987
    }
  ],
  "totalIssues": 10,
  "scanTime": 5678,
  "timestamp": "2024-09-25T21:30:00.000Z",
  "summary": {
    "critical": 2,
    "serious": 4,
    "moderate": 3,
    "minor": 1
  }
}
```

## 🔒 Security Features

- **Non-root container execution** - Runs as `pptuser` for security
- **Sandboxed Chrome browser** - Isolated browser processes
- **Input validation** - URL and parameter sanitization
- **Resource limits** - Memory and timeout constraints
- **Health monitoring** - Built-in health check endpoint

## 📈 Performance Metrics

- **Single Page Scan** - 30-90 seconds average (depends on site complexity)
- **Multi-Page Crawl** - 2-5 minutes for 5 pages average
- **Memory Usage** - ~1.5GB peak during active scans
- **Concurrent Scans** - Supports multiple simultaneous requests
- **Chrome Stability** - Advanced flags for reliable headless operation

## 🐛 Troubleshooting

### Common Issues

1. **Chrome executable not found**
   - Ensure Chrome is installed at `/usr/bin/google-chrome-stable`
   - Check Dockerfile Chrome installation steps

2. **Memory errors during scans**
   - Increase container memory allocation to 2GB+
   - Monitor memory usage in Cloud Run metrics

3. **Timeout errors on slow websites**
   - Check target website performance and response times
   - Verify network connectivity from container
   - Consider increasing timeout limits for specific sites

4. **Permission denied errors**
   - Verify `pptuser` has proper file permissions
   - Check container user configuration in Dockerfile

### Debug Commands

```bash
# Check Chrome installation
google-chrome-stable --version

# Test health endpoint
curl http://localhost:8080/health

# View container logs
docker logs <container-name>

# Check memory usage
docker stats <container-name>
```

## 🚀 Deployment Best Practices

### Cloud Run Configuration
```bash
gcloud run deploy sentryprime-enterprise \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --timeout 300 \
  --max-instances 10 \
  --concurrency 80 \
  --cpu 2
```

### Environment Setup
- **Memory**: 2GB minimum for reliable Chrome operation
- **CPU**: 2 vCPU recommended for concurrent scans
- **Timeout**: 300 seconds for multi-page crawls
- **Concurrency**: 80 requests per instance maximum

## 📝 License

MIT License - Open source accessibility scanning solution.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support & Issues

- **Bug Reports**: Create an issue in this repository
- **Feature Requests**: Open a discussion or issue
- **Documentation**: Check this README and inline code comments
- **Performance**: Monitor Cloud Run metrics and logs

## 🔄 Version History

- **v2.0.0** - Professional dashboard interface with preserved scanning functionality
- **v1.0.0** - Initial enterprise scanner with multi-page crawling capabilities

---

**SentryPrime Enterprise** - Making web accessibility scanning professional, reliable, and scalable.
