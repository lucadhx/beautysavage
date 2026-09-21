import { Router } from 'express';
import * as uploadController from '../controllers/upload.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { uploadImage, translateUploadErrors } from '../middlewares/upload.middleware.js';

const router = Router();

router.use(authenticate);

/**
 * LA TRADUCTION DES REFUS SUIT IMMÉDIATEMENT L'UPLOAD.
 *
 * Un `MulterError` levé par `single('file')` court-circuite le contrôleur : il
 * faut donc l'intercepter ICI, entre l'upload et la suite, sinon il atteint le
 * gestionnaire générique qui n'y voit qu'une exception et rend « Erreur
 * interne ». Voir `translateUploadErrors`.
 */
router.post('/image', uploadImage.single('file'), translateUploadErrors, uploadController.uploadImage);
router.post('/favicon', uploadImage.single('file'), translateUploadErrors, uploadController.uploadFavicon);
router.get('/library', uploadController.mediaLibrary);

/**
 * RETRAIT D'UN MÉDIA — l'opération manquait.
 *
 * Sans elle, un média remplacé restait sur le disque pour toujours : la fiche
 * cessait de le référencer, mais le fichier subsistait, sans plus rien pour
 * dire à qui il appartenait ni s'il était encore utilisé. Le dossier
 * `shared/uploads` grossissait à chaque remplacement.
 */
router.delete('/image/:filename', uploadController.deleteMedia);

export default router;
