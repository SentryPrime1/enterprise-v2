"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getImpactColor, calculateComplianceScore, formatDate } from "@/lib/utils"

interface Violation {
  id: number
  violation_id: string
  description: string
  impact: string
  help: string
  help_url: string
  html: string
  selector: string
}

interface ScanData {
  id: number
  url: string
  total_violations: number
  critical_count: number
  serious_count: number
  moderate_count: number
  minor_count: number
  created_at: string
  violations: Violation[]
}

export default function ScanResultsPage() {
  const params = useParams()
  const router = useRouter()
  const scanId = params.id as string
  
  const [scan, setScan] = useState<ScanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null)

  useEffect(() => {
    fetchScanResults()
  }, [scanId])

  const fetchScanResults = async () => {
    try {
      const response = await fetch(`/api/scans/${scanId}`)
      const data = await response.json()
      setScan(data)
    } catch (error) {
      console.error("Failed to fetch scan results:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading scan results...</div>
      </div>
    )
  }

  if (!scan) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Scan not found</div>
      </div>
    )
  }

  const score = calculateComplianceScore({
    critical: scan.critical_count,
    serious: scan.serious_count,
    moderate: scan.moderate_count,
    minor: scan.minor_count,
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scan Results</h1>
          <p className="mt-2 text-gray-600">{scan.url}</p>
          <p className="text-sm text-gray-500">{formatDate(scan.created_at)}</p>
        </div>
        <button
          onClick={() => router.push("/dashboard/scans/new")}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          New Scan
        </button>
      </div>

      {/* Score Card */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Compliance Score</h2>
            <p className="mt-2 text-blue-100">
              Based on {scan.total_violations} violations found
            </p>
          </div>
          <div className="text-6xl font-bold">{score}%</div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
          <div className="text-3xl font-bold text-red-600">{scan.critical_count}</div>
          <div className="text-sm font-medium text-gray-600 mt-1">Critical</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-orange-500">
          <div className="text-3xl font-bold text-orange-600">{scan.serious_count}</div>
          <div className="text-sm font-medium text-gray-600 mt-1">Serious</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-yellow-500">
          <div className="text-3xl font-bold text-yellow-600">{scan.moderate_count}</div>
          <div className="text-sm font-medium text-gray-600 mt-1">Moderate</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <div className="text-3xl font-bold text-blue-600">{scan.minor_count}</div>
          <div className="text-sm font-medium text-gray-600 mt-1">Minor</div>
        </div>
      </div>

      {/* Start Fixing Button */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Ready to fix these issues?</h3>
            <p className="text-sm text-gray-600 mt-1">
              Use AI-powered suggestions to automatically fix violations
            </p>
          </div>
          <button
            onClick={() => setSelectedViolation(scan.violations[0])}
            className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
          >
            Let's Start Fixing
          </button>
        </div>
      </div>

      {/* Violations List */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">All Violations</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {scan.violations.map((violation) => (
            <div key={violation.id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getImpactColor(violation.impact)}`}>
                      {violation.impact.toUpperCase()}
                    </span>
                    <h3 className="font-medium text-gray-900">{violation.description}</h3>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{violation.help}</p>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <a
                      href={violation.help_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700"
                    >
                      Learn more →
                    </a>
                    <span className="text-gray-500">Selector: {violation.selector}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedViolation(violation)}
                  className="ml-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                >
                  Get AI Fix
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Guided Fixing Modal (placeholder for now) */}
      {selectedViolation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Fix Violation</h2>
              <button
                onClick={() => setSelectedViolation(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600">
                AI-powered fixing modal will be implemented here. This will show:
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                <li>• AI-generated fix code</li>
                <li>• Before/after preview</li>
                <li>• Apply fix button</li>
                <li>• Request alternative fix option</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

