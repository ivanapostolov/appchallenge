const express = require('express');
const router = express.Router();
const Category = require('../models/Category.js');
const Picture = require('../models/Picture.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { getRandomInt } = require('../utils/randomUtils');

const uploadDir = path.join(process.cwd(), 'public/uploads/');

const upload = multer({
  dest: uploadDir,
});

function handleError(res, err) {
  res.status(500).send({ error: err.message });
  console.error(err);
}

function getLocalPath(url) {
  return path.join(process.cwd(), 'public', url);
}

function fsRemove(path) {
  return new Promise((resolve, reject) => {
    fs.unlink(path, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function fsRenameLocal(dir, oldFilename, newFilename) {
  return new Promise((resolve, reject) => {
    fs.rename(path.join(dir, oldFilename), path.join(dir, newFilename), err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getExtension(path) {
  const parts = path.split('.');
  if (parts.length == 1) {
    throw new Error('Unknown file type!');
  } else {
    return parts[parts.length - 1];
  }
}

function parseMatches(matchesString) {
  return matchesString.split(',')
    .map(x => x.trim().toLowerCase());
}

/**
 * GET a randomly generated collection of `limit` pictures
 */
router.get('/categories/:categoryId/:limit', function (req, res, next) {
  const categoryId = req.params.categoryId;
  const limit = parseInt(req.params.limit || '10');
  // The count of latest items to take into account.
  const latestItemsLimit = 50;
  // The count of new items is always between 1 and half of the number of items.
  const latestBucketSize = getRandomInt(1, limit / 2);
  Picture.aggregate([
    { $match: { categoryId: categoryId } },
    { $sort: { dateAdded: -1 } },
    { $limit: latestItemsLimit },
    { $sample: { size: latestBucketSize } },
  ]).then(latest => {
    const latestSet = Array.from(new Set(latest));
    const latestIds = latestSet.map(x => x._id);
    const restItemsCount = limit - latestSet.length;
    console.log({ latestItemsCount: latestSet.length, restItemsCount });
    return Picture.aggregate([
      { $match: { categoryId: categoryId } },
      { $sort: { dateAdded: -1 } },
      { $skip: latestItemsLimit },
      { $sample: { size: restItemsCount } },
      { $match: { _id: { $nin: latestIds } } },
    ]).then(rest => latestSet.concat(rest));
  }).then(pictures => {
    res.send({ pictures });
  }, err => {
    res.status(500).send({ error: err.message });
  });
});

router.post('/categories', upload.single('image'), function (req, res) {
  const image = req.file;
  const { title } = req.body;

  const targetFilename = image.filename + '.' + getExtension(image.originalname).toLowerCase();

  fs.rename(
    path.join(uploadDir, image.filename),
    path.join(uploadDir, targetFilename),
    function (err) {
      if (err) {
        handleError(res, err);
        return;
      }
      const imageUrl = '/uploads/' + targetFilename;
      const category = new Category({
        title: title,
        imageUrl,
        dateAdded: new Date(),
      });
      category.save();
      res.send(category);
    });
});

router.post('/pictures', upload.single('image'), function (req, res) {
  const image = req.file;
  const { matches, categoryId } = req.body;
  const matchArray = parseMatches(matches);

  if (!image || !matches) {
    res.sendStatus(400);
    return;
  }

  Category.findById(categoryId)
    .then(category => {
      if (!category) {
        res.status(400).send({ error: "Internal error!" });
      } else {
        const targetFilename = image.filename + '.' + getExtension(image.originalname).toLowerCase();
        fsRenameLocal(uploadDir, image.filename, targetFilename)
          .then(() => {
            const imageUrl = '/uploads/' + targetFilename;
            const picture = new Picture({
              categoryId,
              matches: matchArray,
              imageUrl,
              dateAdded: new Date(),
            });
            picture.save();
            res.send(picture);
          }, err => {
            handleError(res, err);
          });
      }
    }, err => {
      res.status(500).send({ error: "Server error" });
    });
});

router.post('/pictures/:id', upload.single('image'), function (req, res) {
  const image = req.file;
  const { matches } = req.body;
  const { id } = req.params;
  const matchArray = parseMatches(matches);

  if (!matches) {
    res.status(400).send({ error: 'Missing field `matches`!' });
    return;
  }

  if (!image) {
    Picture.findByIdAndUpdate(id, { matches: matchArray }, { new: true })
      .then(picture => {
        res.send(picture);
      }, err => {
        res.status(500).send({ error: 'Update failed!' });
      });
  } else {
    const targetFilename = image.filename + '.' + getExtension(image.originalname).toLowerCase();
    Promise.all([
      fsRenameLocal(uploadDir, image.filename, targetFilename),
      Picture.findByIdAndUpdate(id, {
        matches: matchArray,
        imageUrl: '/uploads/' + targetFilename,
      })
    ]).then(() => {
      res.send({ message: 'Successfully updated!' });
    }, err => {
      handleError(res, err);
    })
  }

});

router.delete('/categories/:id', function (req, res, next) {
  const id = req.params.id;

  const picturePromise = Picture.find({ categoryId: id })
    .then(pictures => {
      const promises = pictures.map(picture => {
        picture.remove();
        return fsRemove(getLocalPath(picture.imageUrl));
      });
      return Promise.all(promises);
    });

  const categoryPromise = Category.findById(id)
    .then(category => {
      if (category) {
        category.remove();
        return fsRemove(getLocalPath(category.imageUrl));
      }
    });

  Promise.all([picturePromise, categoryPromise])
    .then(() => {
      res.send({ message: "Success!" });
    }, err => {
      handleError(res, err);
    });
});

router.delete('/pictures/:id', function (req, res, next) {
  const id = req.params.id;

  Picture.findByIdAndRemove(id)
    .then(picture => {
      res.status(200).send({ message: 'success' });
    }, err => {
      handleError(res, err);
    });
});

module.exports = router;