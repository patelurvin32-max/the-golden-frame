const express = require('express');
const { body } = require('express-validator');
const { protect, restrictTo } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const validate = require('../middleware/validate');
const branchController = require('../controllers/branchController');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(branchController.getBranches)
  .post(
    restrictTo(ROLES.SUPER_ADMIN),
    [body('name').notEmpty(), body('code').notEmpty()],
    validate,
    branchController.createBranch
  );

router
  .route('/:id')
  .get(branchController.getBranch)
  .patch(restrictTo(ROLES.SUPER_ADMIN), branchController.updateBranch)
  .delete(restrictTo(ROLES.SUPER_ADMIN), branchController.deleteBranch);

module.exports = router;
