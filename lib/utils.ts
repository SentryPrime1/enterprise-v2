import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function getImpactColor(impact: string): string {
  switch (impact.toLowerCase()) {
    case 'critical':
      return 'text-red-600 bg-red-50 border-red-200';
    case 'serious':
      return 'text-orange-600 bg-orange-50 border-orange-200';
    case 'moderate':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'minor':
      return 'text-blue-600 bg-blue-50 border-blue-200';
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

export function calculateComplianceScore(summary: {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}): number {
  const total = summary.critical + summary.serious + summary.moderate + summary.minor;
  if (total === 0) return 100;
  
  // Weight violations by severity
  const weightedScore = (
    summary.critical * 10 +
    summary.serious * 5 +
    summary.moderate * 2 +
    summary.minor * 1
  );
  
  // Calculate score (higher violations = lower score)
  const score = Math.max(0, 100 - weightedScore);
  return Math.round(score);
}

