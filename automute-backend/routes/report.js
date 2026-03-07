const express = require('express');
const router = express.Router();
const { getWeeklyStats } = require('../services/analytics');
const { sendWeeklyReport } = require('../services/email');

// Called by Cloud Scheduler weekly. Secured by a simple shared secret.
router.post('/weekly', async (req, res) => {
  const secret = req.headers['x-report-secret'];
  if (secret !== process.env.REPORT_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const stats = await getWeeklyStats(7);

    if (!stats || stats.total === 0) {
      return res.json({ message: 'No data for this period, report skipped' });
    }

    await sendWeeklyReport(stats);
    res.json({ message: 'Report sent', stats });
  } catch (error) {
    console.error('Report generation failed:', error.message);
    res.status(500).json({ error: 'report_failed', message: error.message });
  }
});

module.exports = router;
