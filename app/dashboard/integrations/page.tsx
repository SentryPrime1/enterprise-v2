"use client"

import { useState } from "react"

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<"wordpress" | "shopify" | "custom">("wordpress")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const [wordpressForm, setWordpressForm] = useState({
    siteUrl: "",
    username: "",
    password: "",
  })

  const [shopifyForm, setShopifyForm] = useState({
    shopUrl: "",
    accessToken: "",
  })

  const [customForm, setCustomForm] = useState({
    websiteUrl: "",
    connectionMethod: "api",
    credentials: "",
  })

  const handleWordPressSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch("/api/integrations/wordpress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wordpressForm),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage({ type: "success", text: "WordPress site connected successfully!" })
        setWordpressForm({ siteUrl: "", username: "", password: "" })
      } else {
        setMessage({ type: "error", text: data.error || "Failed to connect" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred" })
    } finally {
      setLoading(false)
    }
  }

  const handleShopifySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch("/api/integrations/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shopifyForm),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage({ type: "success", text: "Shopify store connected successfully!" })
        setShopifyForm({ shopUrl: "", accessToken: "" })
      } else {
        setMessage({ type: "error", text: data.error || "Failed to connect" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred" })
    } finally {
      setLoading(false)
    }
  }

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch("/api/integrations/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customForm),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage({ type: "success", text: "Custom site connected successfully!" })
        setCustomForm({ websiteUrl: "", connectionMethod: "api", credentials: "" })
      } else {
        setMessage({ type: "error", text: data.error || "Failed to connect" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Platform Integrations</h1>
        <p className="mt-2 text-gray-600">
          Connect your websites to enable automated fix deployment
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg ${
          message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("wordpress")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "wordpress"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            WordPress
          </button>
          <button
            onClick={() => setActiveTab("shopify")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "shopify"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Shopify
          </button>
          <button
            onClick={() => setActiveTab("custom")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "custom"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Custom Site
          </button>
        </nav>
      </div>

      {/* WordPress Form */}
      {activeTab === "wordpress" && (
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Connect WordPress Site</h2>
          <form onSubmit={handleWordPressSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Site URL
              </label>
              <input
                type="url"
                value={wordpressForm.siteUrl}
                onChange={(e) => setWordpressForm({ ...wordpressForm, siteUrl: e.target.value })}
                placeholder="https://yoursite.com"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Admin Username
              </label>
              <input
                type="text"
                value={wordpressForm.username}
                onChange={(e) => setWordpressForm({ ...wordpressForm, username: e.target.value })}
                placeholder="admin"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Application Password
              </label>
              <input
                type="password"
                value={wordpressForm.password}
                onChange={(e) => setWordpressForm({ ...wordpressForm, password: e.target.value })}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-2 text-sm text-gray-500">
                Create an application password in WordPress Admin → Users → Profile
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Connecting..." : "Connect WordPress Site"}
            </button>
          </form>
        </div>
      )}

      {/* Shopify Form */}
      {activeTab === "shopify" && (
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Connect Shopify Store</h2>
          <form onSubmit={handleShopifySubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Shop URL
              </label>
              <input
                type="text"
                value={shopifyForm.shopUrl}
                onChange={(e) => setShopifyForm({ ...shopifyForm, shopUrl: e.target.value })}
                placeholder="yourstore.myshopify.com"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Access Token
              </label>
              <input
                type="password"
                value={shopifyForm.accessToken}
                onChange={(e) => setShopifyForm({ ...shopifyForm, accessToken: e.target.value })}
                placeholder="shpat_..."
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-2 text-sm text-gray-500">
                Generate a private app access token in Shopify Admin → Apps → Develop apps
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Connecting..." : "Connect Shopify Store"}
            </button>
          </form>
        </div>
      )}

      {/* Custom Site Form */}
      {activeTab === "custom" && (
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Connect Custom Site</h2>
          <form onSubmit={handleCustomSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Website URL
              </label>
              <input
                type="url"
                value={customForm.websiteUrl}
                onChange={(e) => setCustomForm({ ...customForm, websiteUrl: e.target.value })}
                placeholder="https://yoursite.com"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Connection Method
              </label>
              <select
                value={customForm.connectionMethod}
                onChange={(e) => setCustomForm({ ...customForm, connectionMethod: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="api">API Integration</option>
                <option value="ftp">FTP Access</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key / Credentials
              </label>
              <textarea
                value={customForm.credentials}
                onChange={(e) => setCustomForm({ ...customForm, credentials: e.target.value })}
                placeholder="Enter your API key or credentials"
                required
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Connecting..." : "Connect Custom Site"}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

