const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

function getClient() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) return null;
  return createClient(config.supabaseUrl, config.supabaseServiceKey);
}

/**
 * Aggregate classification stats for the past N days.
 */
async function getWeeklyStats(days = 7) {
  const db = getClient();
  if (!db) return null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('classifications')
    .select('label, confidence, model_used, flagged, hostname, site_category')
    .gte('timestamp', since);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  if (!data || data.length === 0) return { total: 0 };

  const total = data.length;
  const highConfidence = data.filter(r => r.confidence >= 75).length;
  const escalated = data.filter(r => r.model_used === 'gpt4o').length;
  const flagged = data.filter(r => r.flagged).length;

  // Top 5 hostnames by volume
  const hostnameCounts = {};
  data.forEach(r => {
    if (r.hostname) hostnameCounts[r.hostname] = (hostnameCounts[r.hostname] || 0) + 1;
  });
  const topHostnames = Object.entries(hostnameCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([host, count]) => ({ host, count }));

  return {
    total,
    highConfidencePct: Math.round((highConfidence / total) * 100),
    escalatedPct: Math.round((escalated / total) * 100),
    flaggedPct: Math.round((flagged / total) * 100),
    topHostnames,
    since
  };
}

module.exports = { getWeeklyStats };
