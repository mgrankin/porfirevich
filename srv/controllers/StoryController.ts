import { Request, Response, NextFunction } from 'express';
import { getRepository, Repository, LessThan } from 'typeorm';
import { validate } from 'class-validator';

import { StoriesResponse } from '../../src/interfaces';
import { Story } from '../entity/Story';
import { postcard } from '../utils/postcard';
import { User } from '../entity/User';
import { Like } from '../entity/Like';
import { Violation } from '../entity/Violation';

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
    .select(select.map(x => `story.${x}`))
    .innerJoin('story.user', 'u')
    .andWhere('u.isBanned = :isBanned', { isBanned: false })
    .addSelect(['u.isBanned']);
};

export default class StoryController {
  static all = async (req: Request, res: Response, next: NextFunction) => {
    const beforeDate = req.query.beforeDate
      ? new Date(req.query.beforeDate)
      : new Date();
    const limit =
      req.query.limit && req.query.limit < 51 ? req.query.limit : 10;
    const orderBy = req.query.orderBy as string;
    // // Get stories from database
    try {
      const repository = getRepository(Story);
      const list = query(repository, beforeDate)
        .take(limit)
        .skip(req.query.offset)
        .orderBy('story.createdAt', 'DESC');
      if (orderBy) {
        orderBy.split(',').forEach(x => {
          if (x === 'RAND()') {
            list.orderBy('random()');
          } else {
            list.orderBy(`story.${x}`, 'DESC');
          }
        });
      }
      const [results, itemCount] = await Promise.all([
        list.getMany(),
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
    // @ts-ignore
    const isSuperuser = req.user && req.user.isSuperuser;
    //Get the ID from the url
    const id: string = req.params.id;
    const repository = getRepository(Story);
    try {
      const storyRep = repository
        .createQueryBuilder('story')
        .where({
          id
        })
        .select(select.map(x => `story.${x}`));

      if (isSuperuser) {
        storyRep
          .leftJoin('story.user', 'u')
          .addSelect([
            'u.id',
            'u.username',
            'u.email',
            'u.photoUrl',
            'u.isBanned'
          ]);
      }

      const story = await storyRep.getOne();
      if (story) {
        story.viewsCount = story.viewsCount + 1;
        repository.save(story);
        res.send(story);
      } else {
        res.status(404).send('Story not found');
      }
    } catch (error) {
      res.status(500).send(error);
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
    const repository = getRepository(Story);
    if (userId) {
      const userRepository = getRepository(User);
      const user = await userRepository.findOne(userId);

      if (!user) {
        res.status(400).send();
        return;
      }
      story.user = user;

      if (user.isBanned) {
        // need for that banned user does not immediately guess that something is wrong
        res.send(story);
        return;
      }

      // Validate if the parameters are ok
      const errors = await validate(story);
      if (errors.length > 0) {
        res.status(400).send(errors);
        return;
      }

      const exist = await repository
        .createQueryBuilder('story')
        .where({
          userId,
          content,
          isPublic: true
        })
        .getCount();

      if (exist) {
        if (exist < 20) {
          story.isDeleted = true;
        } else {
          // automatically ban users who save the same thing many times
          user.isBanned = true;
          await userRepository.save(user);

          // need for that banned user does not immediately guess that something is wrong
          res.send(story);
          return;
        }
      }
    }
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

      res.status(200).send();
    } catch (error) {
      res.status(500).send(error);
    }
  };

  static violation = async (req: Request, res: Response) => {
    const storyId = req.params.id;
    // @ts-ignore
    const userId = req.user && req.user.id;
    const storyRepository = getRepository(Story);
    const violationReposytory = getRepository(Violation);
    const userReposytory = getRepository(User);
    try {
      const story = await storyRepository.findOneOrFail(storyId);

      const violation = new Violation();
      violation.story = story;

      if (userId) {
        const user = await userReposytory.findOne(userId);
        violation.user = user;
      }
      await violationReposytory.save(violation);
      res.status(200).send();
    } catch (error) {
      res.status(500).send(error);
    }
  };

  static dislike = async (req: Request, res: Response) => {
    const storyId = req.params.id;
    // @ts-ignore
    const userId = req.user && req.user.id;
    const likeReposytory = getRepository(Like);
    try {
      const existLike = await likeReposytory.findOneOrFail({ userId, storyId });
      likeReposytory.remove(existLike);
      res.send();
    } catch (error) {
      res.status(500).send(error);
    }
  };

  static edit = async (req: Request, res: Response) => {
    const id = req.params.id;
    const { editId, ...params } = req.body;
    // @ts-ignore
    const userId = req.user && req.user.id;
    let user: User | undefined;

    const repository = getRepository(Story);
    let story: Story;
    try {
      story = await repository.findOneOrFail(id);
    } catch (error) {
      res.status(404).send('Story not found');
      return;
    }
    if (userId) {
      const userReposytory = getRepository(User);
      user = await userReposytory.findOne(userId);
    }
    const isSuperuser = user && user.isSuperuser;
    const isOwner = user && story.userId !== user.id;
    if (!user && !isSuperuser && !isOwner) {
      res.status(403).send('Not permitted');
      return;
    }
    // } else if (story.editId !== editId) {
    //   res.status(404).send('No `editId`');
    //   return;
    // }
    // Validate the new values on model
    for (const p in params) {
      if (p in story) {
        // @ts-ignore
        story[p] = params[p];
      }
    }
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
