const express = require('express');
const {
  generateRoutes,
  getRoutes,
  completeStop,
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getWorkers,
  createWorker,
  addTeamMember,
  removeTeamMember,
} = require('../controllers/routeController');
const { authMiddleware, roleMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// All route endpoints are GOV-only (sensitive operations + PII in responses)
router.use(authMiddleware, roleMiddleware(['GOV']));

router.get('/teams', getTeams);
router.post('/teams', createTeam);
router.put('/teams/:id', updateTeam);
router.delete('/teams/:id', deleteTeam);
router.get('/workers', getWorkers);
router.post('/workers', createWorker);
router.post('/teams/:id/members', addTeamMember);
router.delete('/teams/:id/members/:memberId', removeTeamMember);
router.post('/generate', generateRoutes);
router.get('/', getRoutes);
router.put('/:routeId/stop/:stopId', completeStop);

module.exports = router;
