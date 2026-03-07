const { Resend } = require('resend');
const config = require('../config/config');

const resend = new Resend(config.resendApiKey);

async function sendWeeklyReport(stats) {
  if (!config.reportEmail || !config.resendApiKey) {
    console.warn('Email not configured — skipping report send');
    return;
  }

  const subject = `AutoMute Weekly Report — ${stats.total} classifications`;

  const topHostsHtml = (stats.topHostnames || [])
    .map(({ host, count }) => `<li>${host}: ${count}</li>`)
    .join('');

  const html = `
    <h2>AutoMute Weekly Accuracy Report</h2>
    <p><strong>Period:</strong> Last 7 days (since ${new Date(stats.since).toDateString()})</p>
    <hr>
    <h3>Summary</h3>
    <ul>
      <li><strong>Total classifications:</strong> ${stats.total}</li>
      <li><strong>High confidence (≥75%):</strong> ${stats.highConfidencePct}%</li>
      <li><strong>Escalated to gpt-4o:</strong> ${stats.escalatedPct}%</li>
      <li><strong>Flagged (mini/gpt-4o disagreed):</strong> ${stats.flaggedPct}%</li>
    </ul>
    <h3>Top Sites</h3>
    <ol>${topHostsHtml}</ol>
    <p><a href="#">Browse flagged screenshots in Supabase →</a></p>
  `;

  const { error } = await resend.emails.send({
    from: 'AutoMute <reports@yourdomain.com>',
    to: config.reportEmail,
    subject,
    html
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  console.log('Weekly report sent to', config.reportEmail);
}

module.exports = { sendWeeklyReport };
