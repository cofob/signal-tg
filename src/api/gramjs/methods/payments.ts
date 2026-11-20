import { Api as GramJs } from '../../../lib/gramjs';

import { buildApiPremiumPromo } from '../apiBuilders/payments';
import localDb from '../localDb';
import { invokeRequest } from './client';

export async function fetchPremiumPromo() {
  const result = await invokeRequest(new GramJs.help.GetPremiumPromo());
  if (!result) return undefined;

  result.videos.forEach((video) => {
    if (video instanceof GramJs.Document) {
      localDb.documents[video.id.toString()] = video;
    }
  });

  return {
    promo: buildApiPremiumPromo(result),
  };
}
