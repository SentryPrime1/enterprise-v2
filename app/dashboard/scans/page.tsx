"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { formatDate, calculateComplianceScore } from "@/lib/utils"

interface Scan {
  id: number
  url: string
  total_violations: number
  critical_count: number
  serious_count: number
  moderate_count: number
  minor_count: number
  created_at: string
}

export default function ScansPage() {
  const [scans, setScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchScans()
  }, [])

  const fetchScans = async () => {
    try {
      const response = await fetch("/api/scans")
      const data = await response.json()
      setScans(data)
    } catch (error) {
      console.error("Failed to fetch scans:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading scans...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scan History</h1>
          <p className="mt-2 text-gray-600">
            View all your accessibility scans
          </p>
        </div>
        <Link
          href="/dashboard/scans/new"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
        >
          New Scan
        </Link>
      </div>

      {scans.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            No scans yet
          </h3>
          <p className="text-gray-600 mb-6">
            Start your first accessibility scan to get started
          </p>
          <Link
            href="/dashboard/scans/new"
            className="inline-block px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
          >
            Start First Scan
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Violations
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {scans.map((scan) => {
                const score = calculateComplianceScore({
                  critical: scan.critical_count,
                  serious: scan.serious_count,
                  moderate: scan.moderate_count,
                  minor: scan.minor_count,
                })
                
                return (
                  <tr key={scan.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 truncate max-w-md">
                        {scan.url}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {formatDate(scan.created_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <span className={`text-sm font-semibold ${
                          score >= 80 ? 'text-green-600' :
                          score >= 60 ? 'text-yellow-600' :
                          'text-red-600'
                        }`}>
                          {score}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-xs">
                        {scan.critical_count > 0 && (
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
                            {scan.critical_count} critical
                          </span>
                        )}
                        {scan.serious_count > 0 && (
                          <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                            {scan.serious_count} serious
                          </span>
                        )}
                        {scan.moderate_count > 0 && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                            {scan.moderate_count} moderate
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        href={`/dashboard/scans/${scan.id}`}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        View Report
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

