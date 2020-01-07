import { Router } from 'express';
import passport from 'passport';
import StoryController from '../controllers/StoryController';

const router = Router();

export const idDef = '/:id([0-9A-z_-]+)';

router.get(
  '/',
  [passport.authenticate(['jwt', 'anonymous'], { session: false })],
  StoryController.all
);
router.get(idDef, [], StoryController.one);
router.get(idDef + '/postcard', [], StoryController.postcard);

router.post(
  '/',
  [passport.authenticate(['jwt', 'anonymous'], { session: false })],
  StoryController.create
);

router.patch(
  idDef,
  [passport.authenticate(['jwt', 'anonymous'], { session: false })],
  StoryController.edit
);

// router.delete(idDef, [], StoryController.delete);

export default router;
