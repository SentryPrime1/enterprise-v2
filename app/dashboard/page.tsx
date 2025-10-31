"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

interface DashboardStats {
  totalScans: number
  totalIssues: number
  averageScore: number
  recentScans: Array<{
    id: number
    url: string
    score: number
    date: string
    violations: number
  }>
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/dashboard/stats")
      const data = await response.json()
      setStats(data)
    } catch (error) {
      console.error("Failed to fetch stats:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Monitor your accessibility compliance and recent activity
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-blue-100 rounded-lg p-3">
              <span className="text-2xl">🔍</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Scans</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.totalScans || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-orange-100 rounded-lg p-3">
              <span className="text-2xl">⚠️</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Issues Found</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.totalIssues || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-green-100 rounded-lg p-3">
              <span className="text-2xl">📊</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Average Score</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.averageScore || 0}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link
          href="/dashboard/scans/new"
          className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white hover:shadow-xl transition-shadow"
        >
          <div className="text-3xl mb-2">🔍</div>
          <h3 className="text-lg font-semibold">New Scan</h3>
          <p className="text-sm text-blue-100 mt-1">
            Start a new accessibility scan
          </p>
        </Link>

        <Link
          href="/dashboard/scans"
          className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white hover:shadow-xl transition-shadow"
        >
          <div className="text-3xl mb-2">📈</div>
          <h3 className="text-lg font-semibold">View Scans</h3>
          <p className="text-sm text-purple-100 mt-1">
            See all your scan history
          </p>
        </Link>

        <Link
          href="/dashboard/integrations"
          className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white hover:shadow-xl transition-shadow"
        >
          <div className="text-3xl mb-2">🔗</div>
          <h3 className="text-lg font-semibold">Integrations</h3>
          <p className="text-sm text-green-100 mt-1">
            Connect your platforms
          </p>
        </Link>

        <Link
          href="/dashboard/settings"
          className="bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg shadow-lg p-6 text-white hover:shadow-xl transition-shadow"
        >
          <div className="text-3xl mb-2">⚙️</div>
          <h3 className="text-lg font-semibold">Settings</h3>
          <p className="text-sm text-gray-100 mt-1">
            Configure your preferences
          </p>
        </Link>
      </div>

      {/* Recent Scans */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Scans</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {stats?.recentScans && stats.recentScans.length > 0 ? (
            stats.recentScans.map((scan) => (
              <div key={scan.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {scan.url}
                    </p>
                    <p className="text-sm text-gray-500">{scan.date}</p>
                  </div>
                  <div className="ml-4 flex items-center space-x-4">
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        Score: {scan.score}%
                      </p>
                      <p className="text-sm text-gray-500">
                        {scan.violations} issues
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/scans/${scan.id}`}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                    >
                      View
                    </Link>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-6 py-12 text-center text-gray-500">
              No scans yet. Start your first scan to get started!
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

