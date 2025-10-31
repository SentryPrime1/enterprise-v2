"use client"

import { useSession } from "next-auth/react"

export default function SettingsPage() {
  const { data: session } = useSession()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Account Information</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <div className="text-gray-900">{session?.user?.email}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <div className="text-gray-900">{session?.user?.name}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subscription Tier
            </label>
            <div className="text-gray-900 capitalize">{session?.user?.tier || 'Free'}</div>
          </div>
          {session?.user?.company && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company
              </label>
              <div className="text-gray-900">{session.user.company}</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Notification Preferences</h2>
        <p className="text-gray-600">
          Email notification settings will be available in a future update.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Billing</h2>
        <p className="text-gray-600">
          Subscription management will be available in a future update.
        </p>
      </div>
    </div>
  )
}

