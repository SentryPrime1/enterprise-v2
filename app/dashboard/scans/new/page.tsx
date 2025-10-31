"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function NewScanPage() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [scanType, setScanType] = useState<"single" | "multi-page">("single")
  const [maxPages, setMaxPages] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setProgress("Initializing scan...")
    setLoading(true)

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          scanType,
          maxPages: scanType === "multi-page" ? maxPages : 1,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Failed to perform scan")
        setLoading(false)
        return
      }

      setProgress("Scan completed successfully!")
      
      // Redirect to scan results
      setTimeout(() => {
        router.push(`/dashboard/scans/${data.scanId}`)
      }, 1000)
    } catch (error) {
      setError("An error occurred. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">New Accessibility Scan</h1>
        <p className="mt-2 text-gray-600">
          Enter a URL to scan for WCAG compliance violations
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {progress && loading && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
              <div className="flex items-center">
                <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {progress}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
              Website URL
            </label>
            <input
              type="url"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              required
              disabled={loading}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Scan Type
            </label>
            <div className="space-y-3">
              <label className="flex items-start p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="scanType"
                  value="single"
                  checked={scanType === "single"}
                  onChange={(e) => setScanType(e.target.value as "single")}
                  disabled={loading}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900">Single Page</div>
                  <div className="text-sm text-gray-600">Scan only the specified URL</div>
                </div>
              </label>

              <label className="flex items-start p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="scanType"
                  value="multi-page"
                  checked={scanType === "multi-page"}
                  onChange={(e) => setScanType(e.target.value as "multi-page")}
                  disabled={loading}
                  className="mt-1 mr-3"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Multi-Page Crawl</div>
                  <div className="text-sm text-gray-600 mb-3">
                    Crawl and scan multiple pages on the same domain
                  </div>
                  {scanType === "multi-page" && (
                    <div>
                      <label htmlFor="maxPages" className="block text-sm font-medium text-gray-700 mb-1">
                        Maximum pages to scan
                      </label>
                      <input
                        type="number"
                        id="maxPages"
                        min="1"
                        max="100"
                        value={maxPages}
                        onChange={(e) => setMaxPages(parseInt(e.target.value))}
                        disabled={loading}
                        className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              type="button"
              onClick={() => router.push("/dashboard/scans")}
              disabled={loading}
              className="px-6 py-3 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Scanning...
                </>
              ) : (
                "Start Scan"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

