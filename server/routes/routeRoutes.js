const express = require('express');
const {
  generateRoutes,
  getRoutes,
  completeStop,
  getTeams,
} = require('../controllers/routeController');
const { authMiddleware, roleMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// All route endpoints are GOV-only (sensitive operations + PII in responses)
router.use(authMiddleware, roleMiddleware(['GOV']));

router.get('/teams', getTeams);
router.post('/generate', generateRoutes);
router.get('/', getRoutes);
router.put('/:routeId/stop/:stopId', completeStop);

module.exports = router;
