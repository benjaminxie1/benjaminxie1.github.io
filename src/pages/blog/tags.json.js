// Tags used by live posts, for the /write publish sheet's suggestions.
import { livePosts, tagsOf } from '../../data/posts';

export async function GET() {
  const tags = tagsOf(await livePosts()).map((t) => ({ name: t.name, slug: t.slug, count: t.posts.length }));
  return new Response(JSON.stringify(tags), { headers: { 'Content-Type': 'application/json' } });
}
