import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

// Site : https://cgtranslations.me  (WordPress.com blog)
// Site has no novel catalogue: every "novel" is a directory page that
// lists links to dated blog posts (= chapters). So the novel list is static.

type Series = { name: string; path: string; cover?: string };

const SERIES: Series[] = [
  {
    name: 'Konosuba: Main Series (Light Novel)',
    path: '/konosuba/',
    cover: 'https://cgtranslations.me/wp-content/uploads/2019/07/rerecover.png',
  },
  { name: 'Konosuba: Short Stories', path: '/misc-short-stories/' },
  { name: 'Konosuba: Yorimichi', path: '/konosuba-yorimichi/' },
  { name: 'Konosuba: Dust Spinoff', path: '/dustspinoff/' },
  { name: 'Konosuba: Masked Spinoff', path: '/masked-spinoff/' },
  { name: 'Konosuba: Explosions Spinoff', path: '/explosions-spinoff/' },
  { name: 'Konosuba: Misc', path: '/konosuba-misc/' },
  { name: 'Neptunia', path: '/neptunia/' },
  { name: 'Fairy Fencer F', path: '/fairy-fencer-f/' },
  {
    name: 'Imouto sae Ireba Ii: BD Extra Scenes',
    path: '/imouto-sae-ireba-ii-bd-extra-scenes/',
  },
];

// Only links that point to a dated post (/YYYY/MM/DD/slug/) or /?p=123
// on cgtranslations.me are chapters. Everything else is ignored.
const POST_LINK =
  /^(?:https?:\/\/(?:www\.)?cgtranslations\.me)?(\/(?:\d{4}\/\d{2}\/\d{2}\/[^?#]+|\?p=\d+))/;

class CGTranslations implements Plugin.PluginBase {
  id = 'cgtranslations';
  name = 'CGTranslations';
  icon = 'src/en/cgtranslations/icon.png';
  site = 'https://cgtranslations.me';
  version = '1.0.0';

  private toItem(s: Series): Plugin.NovelItem {
    return { name: s.name, path: s.path, cover: s.cover || defaultCover };
  }

  private getContent($: ReturnType<typeof parseHTML>) {
    for (const sel of ['.entry-content', '.post-content', 'article']) {
      const el = $(sel).first();
      if (el.length) return el;
    }
    return $('body');
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    return SERIES.map(s => this.toItem(s));
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    const q = searchTerm.toLowerCase().trim();
    return SERIES.filter(s => s.name.toLowerCase().includes(q)).map(s =>
      this.toItem(s),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const html = await fetchApi(this.site + novelPath).then(r => r.text());
    const $ = parseHTML(html);
    const series = SERIES.find(s => s.path === novelPath);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name:
        series?.name ||
        $('h1.entry-title').first().text().trim() ||
        'CGTranslations',
      cover:
        series?.cover ||
        $('meta[property="og:image"]').attr('content') ||
        defaultCover,
      status: NovelStatus.Unknown,
    };

    const root = this.getContent($);
    root.find('.sharedaddy, #jp-post-flair, .jp-relatedposts').remove();

    const chapters: Plugin.ChapterItem[] = [];
    const seen = new Set<string>();
    let heading = '';

    root.find('h1, h2, h3, h4, a').each((_, el) => {
      const $el = $(el);

      // Headings (e.g. "Volume 3: ...") are used as a prefix for the chapters below them
      if (!$el.is('a')) {
        if (!$el.find('a').length) {
          heading = $el.text().replace(/\s+/g, ' ').trim();
        }
        return;
      }

      const m = ($el.attr('href') || '').trim().match(POST_LINK);
      if (!m) return;

      const path = m[1];
      if (seen.has(path)) return;

      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      seen.add(path);

      const d = path.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\//);

      chapters.push({
        name: heading && heading !== novel.name ? `${heading} - ${text}` : text,
        path,
        releaseTime: d ? `${d[1]}-${d[2]}-${d[3]}` : undefined,
        chapterNumber: chapters.length + 1,
      });
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await fetchApi(this.site + chapterPath).then(r => r.text());
    const $ = parseHTML(html);
    const content = this.getContent($);

    content
      .find(
        '.sharedaddy, #jp-post-flair, .jp-relatedposts, .wpcnt, script, style, iframe, noscript',
      )
      .remove();

    // Remove the "Previous / Next Chapter / Main Directory" footer that
    // comes after the last <hr>. Only if it really looks like a nav footer,
    // so image-only posts (splash pages) are never wiped.
    const lastHr = content.find('hr').last();
    if (lastHr.length) {
      const tail = lastHr.nextAll();
      const tailText = tail.text().replace(/\s+/g, ' ').trim();
      const looksLikeNav = tail
        .find('a')
        .toArray()
        .some(a => /next|previous|directory|index/i.test($(a).text()));
      if (looksLikeNav && tailText.length < 400) {
        tail.remove();
        lastHr.remove();
      }
    }

    return content.html() || '';
  }
}

export default new CGTranslations();
