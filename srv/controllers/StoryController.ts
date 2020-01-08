import { Request, Response, NextFunction } from 'express';
import { getRepository, Repository, LessThan } from 'typeorm';
import { validate } from 'class-validator';

import { StoriesResponse } from '../../src/interfaces';
import { Story } from '../entity/Story';
import { postcard } from '../utils/postcard';
import { User } from '../entity/User';
import { Like } from '../entity/Like';

const select: (keyof Story)[] = [
  'id',
  'content',
  'createdAt',
  'viewsCount',
  'postcard',
  'userId',
  'likesCount'
];

const query = (rep: Repository<Story>, beforeDate: Date) => {
  return rep
    .createQueryBuilder('story')
    .where({
      isPublic: true,
      isDeleted: false,
      createdAt: LessThan(beforeDate.toISOString())
    })
    .select(select.map(x => `story.${x}`));
};

export default class StoryController {
  static all = async (req: Request, res: Response, next: NextFunction) => {
    const beforeDate = req.query.beforeDate
      ? new Date(req.query.beforeDate)
      : new Date();
    // // Get stories from database
    try {
      const repository = getRepository(Story);
      const [results, itemCount] = await Promise.all([
        query(repository, beforeDate)
          .take(req.query.limit)
          .skip(req.query.offset)
          .orderBy('createdAt', 'DESC')
          .getMany(),
        query(repository, beforeDate).getCount()
      ]);

      // const pageCount = Math.ceil(itemCount / req.query.limit);
      const loaded = Number(req.query.offset) + Number(req.query.limit);
      if (req.accepts('json')) {
        // inspired by Stripe's API response for list objects
        const resp: StoriesResponse = {
          object: 'list',
          hasMore: itemCount > loaded,
          count: itemCount,
          data: results,
          beforeDate: beforeDate.getTime()
        };
        res.json(resp);
      }
    } catch (err) {
      next(err);
    }
  };

  static one = async (req: Request, res: Response) => {
    //Get the ID from the url
    const id: string = req.params.id;
    const repository = getRepository(Story);
    try {
      const story = await repository.findOneOrFail(id, {
        select: select
      });
      story.viewsCount = story.viewsCount + 1;
      repository.save(story);
      res.send(story);
    } catch (error) {
      res.status(404).send('Story not found');
    }
  };

  static create = async (req: Request, res: Response) => {
    const { content, description } = req.body;
    const story = new Story();
    let newStory: Story | undefined;
    story.content = content;
    story.description = description;

    // @ts-ignore
    const userId = req.user && req.user.id;
    if (userId) {
      try {
        const userRepository = getRepository(User);
        const user = await userRepository.findOne(userId);
        story.user = user;
      } catch (er) {
        // ignore
      }
    }

    // Validate if the parameters are ok
    const errors = await validate(story);
    if (errors.length > 0) {
      res.status(400).send(errors);
      return;
    }

    const repository = getRepository(Story);
    try {
      newStory = await repository.save(story);
    } catch (e) {
      res.status(500).send(e);
      return;
    }
    try {
      const postcardPath = await postcard(newStory);
      story.postcard = postcardPath;
      newStory = await repository.save(story);
    } catch (e) {
      res.status(500).send(e);
      return;
    }
    if (newStory) {
      res.send(newStory);
    } else {
      res.status(500).send("can't save story");
    }
  };

  static like = async (req: Request, res: Response) => {
    const storyId = req.params.id;
    // @ts-ignore
    const userId = req.user && req.user.id;
    const storyRepository = getRepository(Story);
    const likeReposytory = getRepository(Like);
    const userReposytory = getRepository(User);
    try {
      const existLike = await likeReposytory.findOne({ userId, storyId });
      if (existLike) {
        res.status(409).send('Like from this user already exists');
        return;
      }
      const story = await storyRepository.findOneOrFail(storyId);
      const user = await userReposytory.findOneOrFail(userId);

      const like = new Like();
      like.user = user;
      like.story = story;

      await likeReposytory.save(like);

      story.likesCount = story.likesCount + 1;
      const newStory = await storyRepository.save(story);

      const { id, likesCount } = newStory;

      res.send({ id, likesCount });
    } catch (error) {
      res.status(500).send(error);
    }
  };

  static edit = async (req: Request, res: Response) => {
    const id = req.params.id;
    const { editId, isPublic } = req.body;
    // Try to find story on database
    const repository = getRepository(Story);
    let story: Story;
    try {
      story = await repository.findOneOrFail(id);
    } catch (error) {
      res.status(404).send('Story not found');
      return;
    }
    if (story.editId !== editId) {
      res.status(404).send('No edit URL');
      return;
    }
    // Validate the new values on model
    story.isPublic = isPublic;
    const errors = await validate(story);
    if (errors.length > 0) {
      res.status(400).send(errors);
      return;
    }

    try {
      story = await repository.save(story);
    } catch (e) {
      res.status(409).send("can't save story");
      return;
    }
    res.send(story);
  };

  static delete = async (req: Request, res: Response) => {
    // Get the ID from the url
    const id = req.params.id;

    const repository = getRepository(Story);
    try {
      await repository.findOneOrFail(id);
    } catch (error) {
      res.status(404).send('Story not found');
      return;
    }
    repository.delete(id);

    // After all send a 204 (no content, but accepted) response
    res.status(204).send();
  };

  static postcard = async (req: Request, res: Response) => {
    //Get the ID from the url
    const id: string = req.params.id;

    const repository = getRepository(Story);
    try {
      const story = await repository.findOneOrFail(id, {
        select
      });
      story.viewsCount = story.viewsCount + 1;
      repository.save(story);
      // await postcard(story);
    } catch (error) {
      res.status(404).send('Story not found');
    }
  };
}
