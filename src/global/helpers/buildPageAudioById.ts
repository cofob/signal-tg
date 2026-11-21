import type {
  ApiAudio,
  ApiPageBlock,
  ApiPageBlockAudio,
  ApiPageBlockDocument,
  ApiPageBlockPhoto,
  ApiPageBlockVideo,
} from '../../api/types';

export type PageBlockWithMedia = ApiPageBlockPhoto | ApiPageBlockVideo | ApiPageBlockAudio | ApiPageBlockDocument;

export function getPageBlocksWithMedia(blocks: ApiPageBlock[]): PageBlockWithMedia[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'photo':
      case 'video':
      case 'audio':
      case 'document':
        return [block];
      case 'cover':
        return getPageBlocksWithMedia([block.cover]);
      case 'collage':
      case 'slideshow':
        return getPageBlocksWithMedia(block.items);
      case 'list':
      case 'orderedList':
        return block.items.flatMap((item) => (item.type === 'blocks' ? getPageBlocksWithMedia(item.blocks) : []));
      default:
        return 'blocks' in block ? getPageBlocksWithMedia(block.blocks) : [];
    }
  });
}

export function getPageBlocksAudios(blocks: ApiPageBlock[]): ApiAudio[] {
  return getPageBlocksWithMedia(blocks).flatMap((block) => (block.type === 'audio' ? [block.audio] : []));
}
