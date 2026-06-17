/**
 * =============================================================================
 * Poster Products Seeder — 40 diverse poster products
 * =============================================================================
 *
 * Seeds 40 fully purchasable poster products under the "Posters" subcategory
 * (Home Decor & Festive → Wall Decor → Posters). Mix of:
 *
 *   - 20 SIMPLE products (single variant, one size/finish)
 *   - 20 VARIABLE products with multiple variants differentiated by:
 *       → Size (A4, A3, A2, A1)
 *       → Frame (Unframed, Black Frame, White Frame, Wooden Frame)
 *       → Finish (Matte, Glossy, Canvas)
 *
 * Each product gets:
 *   - 2–4 placeholder images (picsum.photos)
 *   - Inventory (stocked in the demo warehouse)
 *   - SEO keywords & specifications
 *   - Tags (connected via M:N)
 *   - Some are isFeatured, some have compareAtPrice (sale items)
 *
 * Idempotent: upserts on slug/sku unique keys. Safe to re-run.
 *
 * Prerequisites (FAIL-FAST if missing):
 *   - Roles 'seller'            -> run: pnpm seed:roles
 *   - Tax catalog (GST 12%)     -> run: pnpm seed:taxes
 *   - Categories seeded         -> run: pnpm seed:categories
 *   - Demo store + warehouse    -> run: pnpm seed:demo
 *
 * Run:
 *   pnpm seed:posters       (ts-node)
 *   pnpm seed:posters:prod  (compiled)
 * =============================================================================
 */

import { PrismaClient, ProductType, ProductStatus } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POSTER_CATEGORY_SLUG = 'posters';
const DEMO_STORE_SLUG = 'demo-store';
const DEMO_WAREHOUSE_CODE = 'WH-DEMO-01';
const HSN_CODE_POSTERS = '4911'; // Printed matter — posters, art prints
const STOCK_QTY = 50;

// ---------------------------------------------------------------------------
// Size Attribute for variants
// ---------------------------------------------------------------------------

const SIZES = ['A4 (21×30 cm)', 'A3 (30×42 cm)', 'A2 (42×59 cm)', 'A1 (59×84 cm)'];
const SIZE_SLUGS = ['a4', 'a3', 'a2', 'a1'];
const SIZE_PRICES = [299, 499, 799, 1299]; // Base price per size

const FRAMES = ['Unframed', 'Black Frame', 'White Frame', 'Wooden Frame'];
const FRAME_SLUGS = ['unframed', 'black-frame', 'white-frame', 'wooden-frame'];
const FRAME_UPCHARGE = [0, 350, 350, 500];

const FINISHES = ['Matte', 'Glossy', 'Canvas'];
const FINISH_SLUGS = ['matte', 'glossy', 'canvas'];
const FINISH_UPCHARGE = [0, 50, 200];

// ---------------------------------------------------------------------------
// Product definitions
// ---------------------------------------------------------------------------

interface PosterDef {
  name: string;
  slug: string;
  skuPrefix: string;
  productType: ProductType;
  /** For SIMPLE: single price. For VARIABLE: base multiplier applied to SIZE_PRICES */
  priceMultiplier: number;
  compareAtMultiplier: number | null; // null = no sale
  isFeatured: boolean;
  shortDescription: string;
  description: string;
  /** Which variant axis to use: 'size' | 'frame' | 'finish' | 'size-frame' */
  variantAxis: 'none' | 'size' | 'frame' | 'finish' | 'size-frame';
  tags: string[];
  imageSeedBase: string;
  imageCount: number; // 2–4
  specifications: { name: string; order: number; items: { label: string; value: string; order: number }[] }[];
  weight: number; // kg
  seoKeywords: string[];
}

const PRODUCTS: PosterDef[] = [
  // ============ SIMPLE PRODUCTS (1-20) ============
  {
    name: 'Mountain Sunrise Landscape Poster',
    slug: 'mountain-sunrise-landscape-poster',
    skuPrefix: 'PST-MTN-001',
    productType: 'SIMPLE',
    priceMultiplier: 1,
    compareAtMultiplier: 1.4,
    isFeatured: true,
    shortDescription: 'Breathtaking sunrise over misty mountains, printed on premium 250 GSM paper.',
    description: 'Transform your space with this stunning mountain sunrise poster. Captured at golden hour, the warm tones blend seamlessly with cool mountain mist. Printed on archival-quality 250 GSM matte paper with vivid, fade-resistant inks. Perfect for living rooms, bedrooms, and offices.',
    variantAxis: 'none',
    tags: ['nature', 'landscape', 'bestseller'],
    imageSeedBase: 'mountain-sunrise',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
        { label: 'Ink Type', value: 'Fade-resistant UV inks', order: 4 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['mountain poster', 'sunrise poster', 'landscape wall art', 'nature poster'],
  },
  {
    name: 'Vintage World Map Poster',
    slug: 'vintage-world-map-poster',
    skuPrefix: 'PST-MAP-002',
    productType: 'SIMPLE',
    priceMultiplier: 1.2,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Antique-style world map with aged parchment effect.',
    description: 'A beautifully rendered vintage world map with an aged parchment aesthetic. Ideal for study rooms, libraries, and travel enthusiast spaces. Printed on 220 GSM textured paper for an authentic feel.',
    variantAxis: 'none',
    tags: ['vintage', 'maps', 'educational'],
    imageSeedBase: 'vintage-map',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '220 GSM', order: 1 },
        { label: 'Finish', value: 'Textured Matte', order: 2 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['world map poster', 'vintage map', 'antique wall art'],
  },
  {
    name: 'Abstract Geometric Shapes Poster',
    slug: 'abstract-geometric-shapes-poster',
    skuPrefix: 'PST-GEO-003',
    productType: 'SIMPLE',
    priceMultiplier: 0.8,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Minimalist geometric art in pastel tones.',
    description: 'Clean lines and soft pastel hues make this geometric poster a perfect addition to any modern interior. The balanced composition brings calm and sophistication to your wall space.',
    variantAxis: 'none',
    tags: ['abstract', 'minimalist', 'modern'],
    imageSeedBase: 'abstract-geo',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['abstract poster', 'geometric wall art', 'minimalist poster'],
  },
  {
    name: 'Tokyo Night Cityscape Poster',
    slug: 'tokyo-night-cityscape-poster',
    skuPrefix: 'PST-TKY-004',
    productType: 'SIMPLE',
    priceMultiplier: 1.1,
    compareAtMultiplier: 1.5,
    isFeatured: true,
    shortDescription: 'Neon-lit Tokyo streets captured in stunning detail.',
    description: 'Immerse yourself in the electric energy of Tokyo at night. Neon signs reflect off rain-slicked streets, creating a cinematic atmosphere. Printed on glossy 280 GSM photo paper for maximum vibrancy.',
    variantAxis: 'none',
    tags: ['cityscape', 'japan', 'neon', 'trending'],
    imageSeedBase: 'tokyo-night',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['tokyo poster', 'neon cityscape', 'japan wall art', 'night city poster'],
  },
  {
    name: 'Botanical Monstera Leaf Poster',
    slug: 'botanical-monstera-leaf-poster',
    skuPrefix: 'PST-BOT-005',
    productType: 'SIMPLE',
    priceMultiplier: 0.9,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Elegant monstera leaf illustration on white background.',
    description: 'Bring nature indoors with this delicate botanical illustration. The iconic monstera leaf is rendered in rich greens against a clean white background. Perfect for Scandinavian-style interiors.',
    variantAxis: 'none',
    tags: ['botanical', 'nature', 'scandinavian'],
    imageSeedBase: 'monstera-leaf',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A4 (21×30 cm)', order: 3 },
      ]},
    ],
    weight: 0.1,
    seoKeywords: ['monstera poster', 'botanical art', 'plant poster', 'leaf wall art'],
  },
  {
    name: 'Motivational Quote - Dream Big Poster',
    slug: 'motivational-dream-big-poster',
    skuPrefix: 'PST-MOT-006',
    productType: 'SIMPLE',
    priceMultiplier: 0.7,
    compareAtMultiplier: 1.2,
    isFeatured: false,
    shortDescription: 'Inspirational typography poster with gold accents.',
    description: '"Dream Big" rendered in elegant hand-lettered typography with gold foil accents on a deep navy background. A daily dose of motivation for your workspace or bedroom.',
    variantAxis: 'none',
    tags: ['motivational', 'typography', 'office'],
    imageSeedBase: 'dream-big',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '200 GSM', order: 1 },
        { label: 'Finish', value: 'Matte with Gold Foil', order: 2 },
        { label: 'Size', value: 'A4 (21×30 cm)', order: 3 },
      ]},
    ],
    weight: 0.1,
    seoKeywords: ['motivational poster', 'dream big', 'quote poster', 'office decor'],
  },
  {
    name: 'Solar System Planets Educational Poster',
    slug: 'solar-system-planets-poster',
    skuPrefix: 'PST-SOL-007',
    productType: 'SIMPLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Detailed illustration of all planets in our solar system.',
    description: 'An astronomically accurate and visually stunning representation of our solar system. Each planet is illustrated with correct relative sizing and orbital positions. Great for kids rooms, classrooms, and science enthusiasts.',
    variantAxis: 'none',
    tags: ['educational', 'space', 'science', 'kids'],
    imageSeedBase: 'solar-system',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Semi-Gloss', order: 2 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['solar system poster', 'planet poster', 'educational wall art', 'space poster'],
  },
  {
    name: 'Indian Spice Collection Kitchen Poster',
    slug: 'indian-spice-collection-poster',
    skuPrefix: 'PST-SPC-008',
    productType: 'SIMPLE',
    priceMultiplier: 0.85,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Vibrant watercolor illustration of Indian spices.',
    description: 'A feast for the eyes — turmeric, cardamom, cinnamon, cumin, and more rendered in rich watercolors. This kitchen poster celebrates India\'s incredible spice heritage. Ideal for kitchen, dining room, or café walls.',
    variantAxis: 'none',
    tags: ['kitchen', 'indian', 'food', 'watercolor'],
    imageSeedBase: 'indian-spices',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['indian spices poster', 'kitchen wall art', 'spice chart', 'watercolor poster'],
  },
  {
    name: 'Retro Bollywood Movie Art Poster',
    slug: 'retro-bollywood-movie-art-poster',
    skuPrefix: 'PST-BLW-009',
    productType: 'SIMPLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: null,
    isFeatured: true,
    shortDescription: 'Hand-painted retro Bollywood movie poster reproduction.',
    description: 'Relive the golden era of Bollywood with this hand-painted style movie poster. Rich colors and dramatic compositions capture the magic of vintage Indian cinema. A collector\'s piece for film lovers.',
    variantAxis: 'none',
    tags: ['bollywood', 'retro', 'movie', 'indian'],
    imageSeedBase: 'bollywood-retro',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '220 GSM', order: 1 },
        { label: 'Finish', value: 'Textured Matte', order: 2 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['bollywood poster', 'retro movie poster', 'vintage bollywood', 'indian film art'],
  },
  {
    name: 'Zen Garden Minimalist Poster',
    slug: 'zen-garden-minimalist-poster',
    skuPrefix: 'PST-ZEN-010',
    productType: 'SIMPLE',
    priceMultiplier: 0.9,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Serene Japanese zen garden in ink wash style.',
    description: 'Find your inner peace with this ink wash rendering of a traditional Japanese zen garden. Delicate brushstrokes evoke tranquility and mindfulness. Perfect for meditation rooms and minimalist spaces.',
    variantAxis: 'none',
    tags: ['zen', 'minimalist', 'japanese', 'meditation'],
    imageSeedBase: 'zen-garden',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['zen poster', 'japanese garden poster', 'minimalist wall art'],
  },
  {
    name: 'Tropical Flamingo Sunset Poster',
    slug: 'tropical-flamingo-sunset-poster',
    skuPrefix: 'PST-FLM-011',
    productType: 'SIMPLE',
    priceMultiplier: 0.8,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Tropical flamingos silhouetted against a pink sunset.',
    description: 'Escape to the tropics with this dreamy poster featuring flamingos wading in golden waters against a vibrant pink and orange sunset sky.',
    variantAxis: 'none',
    tags: ['tropical', 'flamingo', 'sunset'],
    imageSeedBase: 'flamingo-sunset',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['flamingo poster', 'tropical poster', 'sunset wall art'],
  },
  {
    name: 'Coffee Brewing Guide Infographic Poster',
    slug: 'coffee-brewing-guide-poster',
    skuPrefix: 'PST-COF-012',
    productType: 'SIMPLE',
    priceMultiplier: 0.75,
    compareAtMultiplier: 1.2,
    isFeatured: false,
    shortDescription: 'Illustrated guide to different coffee brewing methods.',
    description: 'From pour-over to French press, espresso to cold brew — this infographic poster covers every popular coffee brewing method with step-by-step illustrations and tips. A must-have for any coffee lover.',
    variantAxis: 'none',
    tags: ['coffee', 'kitchen', 'infographic'],
    imageSeedBase: 'coffee-guide',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '200 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['coffee poster', 'brewing guide poster', 'kitchen wall art', 'coffee infographic'],
  },
  {
    name: 'Watercolor Ocean Waves Poster',
    slug: 'watercolor-ocean-waves-poster',
    skuPrefix: 'PST-OCN-013',
    productType: 'SIMPLE',
    priceMultiplier: 0.9,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Soft watercolor seascape with crashing waves.',
    description: 'The gentle power of the ocean captured in fluid watercolor strokes. Blues, teals, and whites blend organically to create a calming seascape that brings coastal vibes to any room.',
    variantAxis: 'none',
    tags: ['ocean', 'watercolor', 'nature', 'coastal'],
    imageSeedBase: 'ocean-waves',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['ocean poster', 'watercolor poster', 'waves wall art', 'beach poster'],
  },
  {
    name: 'Yoga Poses Chart Poster',
    slug: 'yoga-poses-chart-poster',
    skuPrefix: 'PST-YGA-014',
    productType: 'SIMPLE',
    priceMultiplier: 0.85,
    compareAtMultiplier: 1.2,
    isFeatured: false,
    shortDescription: 'Illustrated guide showing 36 essential yoga poses.',
    description: 'Master your practice with this comprehensive yoga poses chart. Features 36 asanas with Sanskrit names, English translations, and alignment cues. Perfect for home studios and yoga rooms.',
    variantAxis: 'none',
    tags: ['yoga', 'fitness', 'educational', 'wellness'],
    imageSeedBase: 'yoga-chart',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['yoga poster', 'yoga poses chart', 'asana poster', 'fitness wall art'],
  },
  {
    name: 'Art Deco Golden Gatsby Poster',
    slug: 'art-deco-golden-gatsby-poster',
    skuPrefix: 'PST-DEC-015',
    productType: 'SIMPLE',
    priceMultiplier: 1.1,
    compareAtMultiplier: null,
    isFeatured: true,
    shortDescription: 'Opulent Art Deco design with gold and black geometric patterns.',
    description: 'Channel the glamour of the roaring twenties with this luxurious Art Deco poster. Gold metallic accents on deep black create a striking contrast. A statement piece for sophisticated interiors.',
    variantAxis: 'none',
    tags: ['art-deco', 'luxury', 'gold', 'vintage'],
    imageSeedBase: 'art-deco-gold',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Metallic Gloss', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['art deco poster', 'gatsby poster', 'gold wall art', 'luxury poster'],
  },
  {
    name: 'Indian Mandala Art Poster',
    slug: 'indian-mandala-art-poster',
    skuPrefix: 'PST-MND-016',
    productType: 'SIMPLE',
    priceMultiplier: 0.85,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Intricate hand-drawn mandala design in jewel tones.',
    description: 'A mesmerizing mandala pattern inspired by traditional Indian art. Deep jewel tones of ruby, sapphire, and emerald create a rich, meditative focal point for any room.',
    variantAxis: 'none',
    tags: ['mandala', 'indian', 'spiritual', 'meditation'],
    imageSeedBase: 'mandala-art',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['mandala poster', 'indian art poster', 'spiritual wall art'],
  },
  {
    name: 'Classic Car Garage Poster',
    slug: 'classic-car-garage-poster',
    skuPrefix: 'PST-CAR-017',
    productType: 'SIMPLE',
    priceMultiplier: 0.95,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Vintage muscle car illustration in retro garage style.',
    description: 'Rev up your walls with this retro-style muscle car poster. The vintage color palette and distressed texture give it an authentic garage-find feel. Perfect for man caves, garages, and automotive enthusiasts.',
    variantAxis: 'none',
    tags: ['cars', 'retro', 'vintage', 'garage'],
    imageSeedBase: 'classic-car',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '220 GSM', order: 1 },
        { label: 'Finish', value: 'Textured Matte', order: 2 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['car poster', 'vintage car wall art', 'garage poster', 'muscle car poster'],
  },
  {
    name: 'Kawaii Cat Collection Poster',
    slug: 'kawaii-cat-collection-poster',
    skuPrefix: 'PST-KWI-018',
    productType: 'SIMPLE',
    priceMultiplier: 0.7,
    compareAtMultiplier: 1.1,
    isFeatured: false,
    shortDescription: 'Adorable kawaii-style cats in various poses and outfits.',
    description: 'Cat lovers rejoice! This poster features 20 adorable kawaii-style cats each with unique personalities, outfits, and expressions. Cute, colorful, and guaranteed to make you smile.',
    variantAxis: 'none',
    tags: ['kawaii', 'cats', 'cute', 'kids'],
    imageSeedBase: 'kawaii-cats',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '200 GSM', order: 1 },
        { label: 'Finish', value: 'Semi-Gloss', order: 2 },
        { label: 'Size', value: 'A4 (21×30 cm)', order: 3 },
      ]},
    ],
    weight: 0.1,
    seoKeywords: ['kawaii poster', 'cat poster', 'cute wall art', 'kids room poster'],
  },
  {
    name: 'Dark Forest Foggy Path Poster',
    slug: 'dark-forest-foggy-path-poster',
    skuPrefix: 'PST-FOR-019',
    productType: 'SIMPLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Moody photograph of a fog-laden forest path.',
    description: 'Step into the mysterious beauty of a fog-draped forest. Tall trees disappear into the mist, a winding path beckoning you deeper. Printed on fine art paper for gallery-quality depth.',
    variantAxis: 'none',
    tags: ['nature', 'forest', 'moody', 'photography'],
    imageSeedBase: 'foggy-forest',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '260 GSM', order: 1 },
        { label: 'Finish', value: 'Fine Art Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['forest poster', 'foggy path poster', 'nature photography', 'moody wall art'],
  },
  {
    name: 'Periodic Table of Elements Poster',
    slug: 'periodic-table-elements-poster',
    skuPrefix: 'PST-PTE-020',
    productType: 'SIMPLE',
    priceMultiplier: 0.95,
    compareAtMultiplier: 1.4,
    isFeatured: false,
    shortDescription: 'Color-coded periodic table with element details.',
    description: 'A beautifully designed, color-coded periodic table featuring atomic number, weight, electron configuration, and common uses for each element. Essential for students, teachers, and science lovers.',
    variantAxis: 'none',
    tags: ['educational', 'science', 'chemistry'],
    imageSeedBase: 'periodic-table',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Semi-Gloss', order: 2 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['periodic table poster', 'chemistry poster', 'science wall art', 'educational poster'],
  },

  // ============ VARIABLE PRODUCTS (21-40) ============
  {
    name: 'Northern Lights Aurora Poster',
    slug: 'northern-lights-aurora-poster',
    skuPrefix: 'PST-NRL-021',
    productType: 'VARIABLE',
    priceMultiplier: 1.2,
    compareAtMultiplier: 1.6,
    isFeatured: true,
    shortDescription: 'Spectacular aurora borealis over Scandinavian landscape.',
    description: 'Witness the magic of the Northern Lights from your wall. Vivid greens and purples dance across the Arctic sky in this breathtaking photograph. Available in multiple sizes.',
    variantAxis: 'size',
    tags: ['nature', 'aurora', 'photography', 'bestseller'],
    imageSeedBase: 'northern-lights',
    imageCount: 4,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
        { label: 'Ink Type', value: 'Archival pigment inks', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['aurora poster', 'northern lights wall art', 'nature poster'],
  },
  {
    name: 'Rajasthani Folk Art Poster',
    slug: 'rajasthani-folk-art-poster',
    skuPrefix: 'PST-RAJ-022',
    productType: 'VARIABLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: null,
    isFeatured: true,
    shortDescription: 'Traditional Rajasthani Phad painting style artwork.',
    description: 'Inspired by the centuries-old Phad painting tradition of Rajasthan, this poster features vibrant colors and intricate patterns depicting rural life and mythology. Choose your preferred size and framing.',
    variantAxis: 'size-frame',
    tags: ['indian', 'folk-art', 'rajasthan', 'traditional'],
    imageSeedBase: 'rajasthani-art',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Art Style', value: 'Phad Painting Reproduction', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['rajasthani art poster', 'phad painting', 'indian folk art', 'rajasthan wall art'],
  },
  {
    name: 'Cyberpunk City 2099 Poster',
    slug: 'cyberpunk-city-2099-poster',
    skuPrefix: 'PST-CYB-023',
    productType: 'VARIABLE',
    priceMultiplier: 1.1,
    compareAtMultiplier: 1.5,
    isFeatured: false,
    shortDescription: 'Futuristic cyberpunk cityscape with holographic billboards.',
    description: 'Enter a neon-drenched future city with towering megastructures, flying vehicles, and holographic advertisements. This sci-fi poster is perfect for gamers, tech enthusiasts, and sci-fi fans.',
    variantAxis: 'size',
    tags: ['cyberpunk', 'sci-fi', 'futuristic', 'neon'],
    imageSeedBase: 'cyberpunk-city',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['cyberpunk poster', 'sci-fi wall art', 'futuristic city poster'],
  },
  {
    name: 'Mughal Architecture Poster Set',
    slug: 'mughal-architecture-poster',
    skuPrefix: 'PST-MUG-024',
    productType: 'VARIABLE',
    priceMultiplier: 1.3,
    compareAtMultiplier: null,
    isFeatured: true,
    shortDescription: 'Majestic Mughal architecture in watercolor style.',
    description: 'A tribute to India\'s magnificent Mughal heritage. Features the Taj Mahal rendered in a dreamy watercolor style with delicate detailing. Available in multiple finishes to suit your decor.',
    variantAxis: 'finish',
    tags: ['indian', 'architecture', 'mughal', 'watercolor'],
    imageSeedBase: 'mughal-arch',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250–350 GSM (varies by finish)', order: 1 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 2 },
        { label: 'Subject', value: 'Taj Mahal Watercolor', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['mughal poster', 'taj mahal wall art', 'indian architecture poster'],
  },
  {
    name: 'Galaxy Nebula Deep Space Poster',
    slug: 'galaxy-nebula-deep-space-poster',
    skuPrefix: 'PST-GAL-025',
    productType: 'VARIABLE',
    priceMultiplier: 1.15,
    compareAtMultiplier: 1.5,
    isFeatured: false,
    shortDescription: 'Stunning nebula photograph from deep space telescope.',
    description: 'Gaze into the infinite beauty of a stellar nebula. Rich purples, pinks, and blues swirl around newly born stars. Based on actual telescope imagery, this poster brings the cosmos to your walls.',
    variantAxis: 'size',
    tags: ['space', 'galaxy', 'science', 'photography'],
    imageSeedBase: 'galaxy-nebula',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
        { label: 'Color Space', value: 'Enhanced from NASA imagery', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['galaxy poster', 'nebula wall art', 'space poster', 'deep space poster'],
  },
  {
    name: 'Boho Macramé Pattern Poster',
    slug: 'boho-macrame-pattern-poster',
    skuPrefix: 'PST-BOH-026',
    productType: 'VARIABLE',
    priceMultiplier: 0.9,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Bohemian macramé knot patterns in earthy tones.',
    description: 'Embrace bohemian style with this warm, earthy poster featuring intricate macramé patterns. Terracotta, cream, and sage green tones blend for a cozy, textured look.',
    variantAxis: 'frame',
    tags: ['boho', 'bohemian', 'macrame', 'earthy'],
    imageSeedBase: 'boho-macrame',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['boho poster', 'macrame wall art', 'bohemian poster'],
  },
  {
    name: 'Anatomy of the Human Heart Poster',
    slug: 'anatomy-human-heart-poster',
    skuPrefix: 'PST-ANA-027',
    productType: 'VARIABLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Detailed anatomical illustration of the human heart.',
    description: 'A medically accurate and artistically rendered illustration of the human heart, complete with labeled chambers, valves, and major blood vessels. Ideal for medical students, clinics, and science enthusiasts.',
    variantAxis: 'size',
    tags: ['anatomy', 'medical', 'educational', 'science'],
    imageSeedBase: 'anatomy-heart',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Accuracy', value: 'Medically reviewed', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['anatomy poster', 'heart poster', 'medical wall art', 'educational poster'],
  },
  {
    name: 'Kerala Backwaters Photography Poster',
    slug: 'kerala-backwaters-photography-poster',
    skuPrefix: 'PST-KER-028',
    productType: 'VARIABLE',
    priceMultiplier: 1.1,
    compareAtMultiplier: null,
    isFeatured: true,
    shortDescription: 'Serene houseboat on Kerala backwaters at golden hour.',
    description: 'Transport yourself to the tranquil backwaters of Kerala. A traditional houseboat glides through palm-fringed canals as the sun sets in hues of gold and amber. Professional photography printed on fine art paper.',
    variantAxis: 'size-frame',
    tags: ['india', 'kerala', 'travel', 'photography'],
    imageSeedBase: 'kerala-backwaters',
    imageCount: 4,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Fine Art Matte', order: 2 },
        { label: 'Photography', value: 'Professional landscape', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['kerala poster', 'backwaters wall art', 'india travel poster'],
  },
  {
    name: 'Music Icons Collage Poster',
    slug: 'music-icons-collage-poster',
    skuPrefix: 'PST-MUS-029',
    productType: 'VARIABLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: 1.4,
    isFeatured: false,
    shortDescription: 'Pop art collage of legendary music instruments.',
    description: 'Celebrate music history with this vibrant pop art collage featuring iconic instruments — guitars, pianos, drums, and more — in bold, contrasting colors. Rock your room walls!',
    variantAxis: 'finish',
    tags: ['music', 'pop-art', 'collage', 'instruments'],
    imageSeedBase: 'music-collage',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 2 },
        { label: 'Art Style', value: 'Pop Art', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['music poster', 'pop art poster', 'instruments wall art'],
  },
  {
    name: 'Warli Art Village Life Poster',
    slug: 'warli-art-village-life-poster',
    skuPrefix: 'PST-WAR-030',
    productType: 'VARIABLE',
    priceMultiplier: 0.95,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Traditional Warli tribal art depicting village scenes.',
    description: 'A celebration of Maharashtra\'s indigenous Warli art tradition. Simple white stick figures on a terracotta background depict daily village life — farming, dancing, and community celebrations.',
    variantAxis: 'size',
    tags: ['warli', 'tribal', 'indian', 'folk-art'],
    imageSeedBase: 'warli-village',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '220 GSM', order: 1 },
        { label: 'Finish', value: 'Textured Matte', order: 2 },
        { label: 'Art Style', value: 'Traditional Warli', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['warli art poster', 'tribal poster', 'indian folk art', 'village life poster'],
  },
  {
    name: 'Himalayan Peak Photography Poster',
    slug: 'himalayan-peak-photography-poster',
    skuPrefix: 'PST-HIM-031',
    productType: 'VARIABLE',
    priceMultiplier: 1.3,
    compareAtMultiplier: 1.7,
    isFeatured: true,
    shortDescription: 'Snow-capped Himalayan peaks against a crystal blue sky.',
    description: 'Majesty of the Himalayas captured in breathtaking detail. The play of light on snow-covered peaks creates a dramatic landscape that commands attention. Museum-quality giclée print.',
    variantAxis: 'size-frame',
    tags: ['himalaya', 'mountains', 'india', 'photography', 'bestseller'],
    imageSeedBase: 'himalayan-peak',
    imageCount: 4,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '300 GSM', order: 1 },
        { label: 'Finish', value: 'Giclée Fine Art', order: 2 },
        { label: 'Photography', value: 'Professional landscape', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['himalayan poster', 'mountain photography poster', 'india landscape'],
  },
  {
    name: 'Anime Girl Cherry Blossom Poster',
    slug: 'anime-girl-cherry-blossom-poster',
    skuPrefix: 'PST-ANM-032',
    productType: 'VARIABLE',
    priceMultiplier: 0.9,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Beautiful anime-style illustration under sakura trees.',
    description: 'A stunningly detailed anime illustration featuring a serene scene under cherry blossom trees. Soft pinks and whites create a dreamlike atmosphere. Perfect for anime fans and those who love Japanese aesthetics.',
    variantAxis: 'size',
    tags: ['anime', 'japanese', 'cherry-blossom', 'illustration'],
    imageSeedBase: 'anime-sakura',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Semi-Gloss', order: 2 },
        { label: 'Art Style', value: 'Digital Anime Illustration', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['anime poster', 'cherry blossom poster', 'japanese wall art'],
  },
  {
    name: 'Varanasi Ghat Sunrise Poster',
    slug: 'varanasi-ghat-sunrise-poster',
    skuPrefix: 'PST-VNS-033',
    productType: 'VARIABLE',
    priceMultiplier: 1.1,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Atmospheric sunrise at the Varanasi ghats on the Ganges.',
    description: 'Witness the spiritual beauty of Varanasi at dawn. Boats line the Ganges as the sun rises over ancient ghats, casting golden light through the morning mist. A powerful photographic print.',
    variantAxis: 'finish',
    tags: ['varanasi', 'india', 'spiritual', 'photography'],
    imageSeedBase: 'varanasi-ghat',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 2 },
        { label: 'Photography', value: 'Documentary landscape', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['varanasi poster', 'ghat wall art', 'india spiritual poster'],
  },
  {
    name: 'Abstract Fluid Marble Art Poster',
    slug: 'abstract-fluid-marble-poster',
    skuPrefix: 'PST-FLD-034',
    productType: 'VARIABLE',
    priceMultiplier: 0.95,
    compareAtMultiplier: 1.4,
    isFeatured: false,
    shortDescription: 'Mesmerizing fluid art with marble-like swirls.',
    description: 'Organic swirls of deep teal, gold, and cream create a luxurious marble effect. This fluid art poster adds instant elegance to bedrooms, living rooms, and office spaces.',
    variantAxis: 'frame',
    tags: ['abstract', 'fluid-art', 'marble', 'luxury'],
    imageSeedBase: 'fluid-marble',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['fluid art poster', 'marble wall art', 'abstract poster'],
  },
  {
    name: 'Indian Street Food Chart Poster',
    slug: 'indian-street-food-chart-poster',
    skuPrefix: 'PST-STF-035',
    productType: 'VARIABLE',
    priceMultiplier: 0.85,
    compareAtMultiplier: 1.2,
    isFeatured: false,
    shortDescription: 'Illustrated guide to iconic Indian street foods.',
    description: 'From pani puri to vada pav, samosa to jalebi — this vibrant poster illustrates India\'s most beloved street foods with witty descriptions. A conversation starter for any kitchen or dining space.',
    variantAxis: 'size',
    tags: ['food', 'indian', 'kitchen', 'infographic'],
    imageSeedBase: 'street-food',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Matte', order: 2 },
        { label: 'Illustrations', value: '24 street food items', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['street food poster', 'indian food poster', 'kitchen wall art'],
  },
  {
    name: 'Underwater Coral Reef Poster',
    slug: 'underwater-coral-reef-poster',
    skuPrefix: 'PST-CRL-036',
    productType: 'VARIABLE',
    priceMultiplier: 1.05,
    compareAtMultiplier: null,
    isFeatured: false,
    shortDescription: 'Vibrant underwater photograph of a tropical coral reef.',
    description: 'Dive into a world of color with this stunning underwater photograph. Tropical fish dart between vibrant coral formations in crystal-clear waters. Printed on waterproof photo paper for bathroom-safe display.',
    variantAxis: 'size',
    tags: ['ocean', 'coral', 'underwater', 'photography'],
    imageSeedBase: 'coral-reef',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Glossy', order: 2 },
        { label: 'Water Resistant', value: 'Yes (suitable for bathrooms)', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['coral reef poster', 'underwater poster', 'ocean wall art'],
  },
  {
    name: 'Madhubani Peacock Art Poster',
    slug: 'madhubani-peacock-art-poster',
    skuPrefix: 'PST-MAD-037',
    productType: 'VARIABLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: 1.4,
    isFeatured: true,
    shortDescription: 'Vibrant Madhubani painting featuring ornate peacocks.',
    description: 'A stunning reproduction of traditional Madhubani art from Bihar. Intricate peacock motifs are rendered in vibrant natural colors — this poster captures the essence of one of India\'s most celebrated art forms.',
    variantAxis: 'size-frame',
    tags: ['madhubani', 'indian', 'folk-art', 'peacock'],
    imageSeedBase: 'madhubani-peacock',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Art Style', value: 'Madhubani / Mithila', order: 2 },
        { label: 'Origin', value: 'Bihar, India', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['madhubani poster', 'peacock wall art', 'indian art poster'],
  },
  {
    name: 'Synthwave Retro Grid Poster',
    slug: 'synthwave-retro-grid-poster',
    skuPrefix: 'PST-SYN-038',
    productType: 'VARIABLE',
    priceMultiplier: 0.9,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: '80s synthwave aesthetic with neon grid and sunset.',
    description: 'Vaporwave meets synthwave in this retro-futuristic poster. A glowing neon grid stretches toward a sunset sky in gradient pinks and purples. Perfect for gaming rooms and retro-themed spaces.',
    variantAxis: 'frame',
    tags: ['synthwave', 'retro', 'neon', 'vaporwave'],
    imageSeedBase: 'synthwave-grid',
    imageCount: 2,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '250 GSM', order: 1 },
        { label: 'Finish', value: 'Semi-Gloss', order: 2 },
        { label: 'Size', value: 'A3 (30×42 cm)', order: 3 },
      ]},
    ],
    weight: 0.12,
    seoKeywords: ['synthwave poster', 'retro poster', 'vaporwave wall art', '80s poster'],
  },
  {
    name: 'Ganesha Modern Art Poster',
    slug: 'ganesha-modern-art-poster',
    skuPrefix: 'PST-GAN-039',
    productType: 'VARIABLE',
    priceMultiplier: 1.1,
    compareAtMultiplier: null,
    isFeatured: true,
    shortDescription: 'Contemporary artistic interpretation of Lord Ganesha.',
    description: 'A modern, abstract interpretation of Lord Ganesha blending traditional iconography with contemporary art techniques. Bold brushstrokes and vibrant colors create a powerful spiritual statement piece.',
    variantAxis: 'size-frame',
    tags: ['spiritual', 'ganesha', 'indian', 'modern-art'],
    imageSeedBase: 'ganesha-modern',
    imageCount: 4,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '280 GSM', order: 1 },
        { label: 'Finish', value: 'Fine Art Matte', order: 2 },
        { label: 'Art Style', value: 'Contemporary / Abstract', order: 3 },
      ]},
    ],
    weight: 0.15,
    seoKeywords: ['ganesha poster', 'spiritual wall art', 'modern ganesha art'],
  },
  {
    name: 'Indian Railways Heritage Poster',
    slug: 'indian-railways-heritage-poster',
    skuPrefix: 'PST-RLY-040',
    productType: 'VARIABLE',
    priceMultiplier: 1.0,
    compareAtMultiplier: 1.3,
    isFeatured: false,
    shortDescription: 'Vintage Indian Railways travel poster in retro style.',
    description: 'A tribute to the golden age of Indian railways travel posters. This retro-styled poster features a steam locomotive crossing a scenic viaduct with the tagline "Discover India by Rail". A nostalgic collector\'s piece.',
    variantAxis: 'finish',
    tags: ['vintage', 'railways', 'indian', 'retro', 'travel'],
    imageSeedBase: 'indian-railways',
    imageCount: 3,
    specifications: [
      { name: 'Print Details', order: 1, items: [
        { label: 'Paper Weight', value: '220–350 GSM (varies by finish)', order: 1 },
        { label: 'Size', value: 'A2 (42×59 cm)', order: 2 },
        { label: 'Art Style', value: 'Vintage Travel Poster', order: 3 },
      ]},
    ],
    weight: 0.2,
    seoKeywords: ['indian railways poster', 'vintage travel poster', 'train poster'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function imageUrl(seed: string, idx: number): string {
  return `https://picsum.photos/seed/${seed}-${idx}/800/800`;
}

/** Fail-fast prerequisite lookup. */
async function getOrFail<T>(
  label: string,
  getter: () => Promise<T | null>,
): Promise<T> {
  const item = await getter();
  if (!item) {
    throw new Error(
      `[posterProducts.seed] Required "${label}" not found. ` +
        'Run prerequisite seeds: pnpm seed:roles && pnpm seed:taxes && pnpm seed:categories && pnpm seed:demo',
    );
  }
  return item;
}

/** Ensure a tag exists (upsert by name). */
async function ensureTag(name: string): Promise<string> {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const tag = await prisma.tag.upsert({
    where: { name },
    update: {},
    create: { name, slug, status: 'ACTIVE' },
  });
  return tag.id;
}

/** Ensure a product attribute + values exist (for variant axes). */
async function ensureAttribute(
  name: string,
  slug: string,
  values: { value: string; slug: string }[],
): Promise<{ attrId: string; valueIds: Map<string, string> }> {
  const attr = await prisma.productAttribute.upsert({
    where: { name },
    update: {},
    create: {
      name,
      slug,
      type: 'SELECT',
      isVariantAttribute: true,
    },
  });

  const valueIds = new Map<string, string>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const existing = await prisma.productAttributeValue.findUnique({
      where: { attributeId_value: { attributeId: attr.id, value: v.value } },
    });
    if (existing) {
      valueIds.set(v.slug, existing.id);
    } else {
      const created = await prisma.productAttributeValue.create({
        data: {
          attributeId: attr.id,
          value: v.value,
          slug: v.slug,
          displayOrder: i,
        },
      });
      valueIds.set(v.slug, created.id);
    }
  }

  return { attrId: attr.id, valueIds };
}

// ---------------------------------------------------------------------------
// Core creation logic
// ---------------------------------------------------------------------------

async function createSimpleProduct(
  p: PosterDef,
  ctx: { storeId: string; categoryId: string; taxId: string; warehouseId: string },
  tagIds: string[],
) {
  const price = Math.round(499 * p.priceMultiplier);
  const compareAtPrice = p.compareAtMultiplier
    ? Math.round(499 * p.compareAtMultiplier)
    : null;

  // 1) Product
  const product = await prisma.product.upsert({
    where: { slug: p.slug },
    update: {
      status: 'ACTIVE',
      storeId: ctx.storeId,
      categoryId: ctx.categoryId,
      taxId: ctx.taxId,
      basePrice: price,
      isFeatured: p.isFeatured,
      onSale: compareAtPrice !== null && compareAtPrice > price,
      deletedAt: null,
    },
    create: {
      storeId: ctx.storeId,
      categoryId: ctx.categoryId,
      taxId: ctx.taxId,
      name: p.name,
      slug: p.slug,
      shortDescription: p.shortDescription,
      description: p.description,
      skuPrefix: p.skuPrefix,
      productType: 'SIMPLE',
      status: 'ACTIVE',
      isFeatured: p.isFeatured,
      hsnCode: HSN_CODE_POSTERS,
      countryOfOrigin: 'IN',
      isPriceTaxInclusive: true,
      basePrice: price,
      onSale: compareAtPrice !== null && compareAtPrice > price,
      weight: p.weight,
      seoTitle: `${p.name} | Buy Online`,
      seoDescription: p.shortDescription,
      seoKeywords: p.seoKeywords,
      specifications: p.specifications,
    },
  });

  // 2) Images
  if ((await prisma.productImage.count({ where: { productId: product.id } })) === 0) {
    for (let i = 0; i < p.imageCount; i++) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          imageUrl: imageUrl(p.imageSeedBase, i + 1),
          altText: `${p.name} - Image ${i + 1}`,
          displayOrder: i,
          isPrimary: i === 0,
        },
      });
    }
  }

  // 3) Single variant
  const sku = `${p.skuPrefix}-DEFAULT`;
  const variant = await prisma.productVariant.upsert({
    where: { sku },
    update: {
      price,
      compareAtPrice,
      status: 'ACTIVE',
      productId: product.id,
      deletedAt: null,
    },
    create: {
      productId: product.id,
      sku,
      name: 'Default',
      price,
      compareAtPrice,
      status: 'ACTIVE',
      weight: p.weight,
    },
  });

  // 4) Inventory
  await prisma.inventory.upsert({
    where: {
      variantId_warehouseId: {
        variantId: variant.id,
        warehouseId: ctx.warehouseId,
      },
    },
    update: {
      quantityOnHand: STOCK_QTY,
      quantityReserved: 0,
      quantityAvailable: STOCK_QTY,
      deletedAt: null,
    },
    create: {
      variantId: variant.id,
      warehouseId: ctx.warehouseId,
      quantityOnHand: STOCK_QTY,
      quantityReserved: 0,
      quantityAvailable: STOCK_QTY,
      reorderPoint: 5,
    },
  });

  // 5) Tags (M:N connect)
  if (tagIds.length > 0) {
    await prisma.product.update({
      where: { id: product.id },
      data: { tags: { set: tagIds.map((id) => ({ id })) } },
    });
  }

  return product;
}

interface AttrRegistry {
  size?: { attrId: string; valueIds: Map<string, string> };
  frame?: { attrId: string; valueIds: Map<string, string> };
  finish?: { attrId: string; valueIds: Map<string, string> };
}

async function createVariableProduct(
  p: PosterDef,
  ctx: { storeId: string; categoryId: string; taxId: string; warehouseId: string },
  tagIds: string[],
  attrs: AttrRegistry,
) {
  // Build variant combos based on axis
  interface VariantCombo {
    suffix: string;
    label: string;
    priceDelta: number;
    attrLinks: { attrId: string; valueId: string }[];
  }
  const combos: VariantCombo[] = [];

  if (p.variantAxis === 'size') {
    for (let i = 0; i < SIZES.length; i++) {
      combos.push({
        suffix: SIZE_SLUGS[i],
        label: SIZES[i],
        priceDelta: SIZE_PRICES[i],
        attrLinks: attrs.size
          ? [{ attrId: attrs.size.attrId, valueId: attrs.size.valueIds.get(SIZE_SLUGS[i])! }]
          : [],
      });
    }
  } else if (p.variantAxis === 'frame') {
    for (let i = 0; i < FRAMES.length; i++) {
      const basePrice = Math.round(499 * p.priceMultiplier);
      combos.push({
        suffix: FRAME_SLUGS[i],
        label: FRAMES[i],
        priceDelta: basePrice + FRAME_UPCHARGE[i],
        attrLinks: attrs.frame
          ? [{ attrId: attrs.frame.attrId, valueId: attrs.frame.valueIds.get(FRAME_SLUGS[i])! }]
          : [],
      });
    }
  } else if (p.variantAxis === 'finish') {
    for (let i = 0; i < FINISHES.length; i++) {
      const basePrice = Math.round(499 * p.priceMultiplier);
      combos.push({
        suffix: FINISH_SLUGS[i],
        label: FINISHES[i],
        priceDelta: basePrice + FINISH_UPCHARGE[i],
        attrLinks: attrs.finish
          ? [{ attrId: attrs.finish.attrId, valueId: attrs.finish.valueIds.get(FINISH_SLUGS[i])! }]
          : [],
      });
    }
  } else if (p.variantAxis === 'size-frame') {
    // Full matrix: size × frame (but limited to A3 and A2 + all 4 frames = 8 variants)
    const selectedSizes = [1, 2]; // A3, A2
    for (const si of selectedSizes) {
      for (let fi = 0; fi < FRAMES.length; fi++) {
        combos.push({
          suffix: `${SIZE_SLUGS[si]}-${FRAME_SLUGS[fi]}`,
          label: `${SIZES[si]} / ${FRAMES[fi]}`,
          priceDelta: SIZE_PRICES[si] * p.priceMultiplier + FRAME_UPCHARGE[fi],
          attrLinks: [
            ...(attrs.size ? [{ attrId: attrs.size.attrId, valueId: attrs.size.valueIds.get(SIZE_SLUGS[si])! }] : []),
            ...(attrs.frame ? [{ attrId: attrs.frame.attrId, valueId: attrs.frame.valueIds.get(FRAME_SLUGS[fi])! }] : []),
          ],
        });
      }
    }
  }

  if (combos.length === 0) return null;

  // Lowest price for basePrice
  const lowestPrice = Math.min(...combos.map((c) => Math.round(c.priceDelta)));

  // 1) Product
  const product = await prisma.product.upsert({
    where: { slug: p.slug },
    update: {
      status: 'ACTIVE',
      storeId: ctx.storeId,
      categoryId: ctx.categoryId,
      taxId: ctx.taxId,
      basePrice: lowestPrice,
      isFeatured: p.isFeatured,
      onSale: p.compareAtMultiplier !== null,
      deletedAt: null,
    },
    create: {
      storeId: ctx.storeId,
      categoryId: ctx.categoryId,
      taxId: ctx.taxId,
      name: p.name,
      slug: p.slug,
      shortDescription: p.shortDescription,
      description: p.description,
      skuPrefix: p.skuPrefix,
      productType: 'VARIABLE',
      status: 'ACTIVE',
      isFeatured: p.isFeatured,
      hsnCode: HSN_CODE_POSTERS,
      countryOfOrigin: 'IN',
      isPriceTaxInclusive: true,
      basePrice: lowestPrice,
      onSale: p.compareAtMultiplier !== null,
      weight: p.weight,
      seoTitle: `${p.name} | Buy Online`,
      seoDescription: p.shortDescription,
      seoKeywords: p.seoKeywords,
      specifications: p.specifications,
    },
  });

  // 2) Images
  if ((await prisma.productImage.count({ where: { productId: product.id } })) === 0) {
    for (let i = 0; i < p.imageCount; i++) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          imageUrl: imageUrl(p.imageSeedBase, i + 1),
          altText: `${p.name} - Image ${i + 1}`,
          displayOrder: i,
          isPrimary: i === 0,
        },
      });
    }
  }

  // 3) Variants + Inventory + Attribute links
  for (const combo of combos) {
    const sku = `${p.skuPrefix}-${combo.suffix.toUpperCase()}`;
    const varPrice = Math.round(combo.priceDelta);
    const compareAtPrice = p.compareAtMultiplier
      ? Math.round(varPrice * (p.compareAtMultiplier / p.priceMultiplier))
      : null;

    const variant = await prisma.productVariant.upsert({
      where: { sku },
      update: {
        price: varPrice,
        compareAtPrice,
        status: 'ACTIVE',
        productId: product.id,
        deletedAt: null,
      },
      create: {
        productId: product.id,
        sku,
        name: combo.label,
        price: varPrice,
        compareAtPrice,
        status: 'ACTIVE',
        weight: p.weight,
      },
    });

    // Attribute links (idempotent — @@id([variantId, attributeId]))
    for (const link of combo.attrLinks) {
      if (!link.valueId) continue;
      await prisma.productVariantAttribute.upsert({
        where: {
          variantId_attributeId: {
            variantId: variant.id,
            attributeId: link.attrId,
          },
        },
        update: { attributeValueId: link.valueId },
        create: {
          variantId: variant.id,
          attributeId: link.attrId,
          attributeValueId: link.valueId,
        },
      });
    }

    // Inventory
    await prisma.inventory.upsert({
      where: {
        variantId_warehouseId: {
          variantId: variant.id,
          warehouseId: ctx.warehouseId,
        },
      },
      update: {
        quantityOnHand: STOCK_QTY,
        quantityReserved: 0,
        quantityAvailable: STOCK_QTY,
        deletedAt: null,
      },
      create: {
        variantId: variant.id,
        warehouseId: ctx.warehouseId,
        quantityOnHand: STOCK_QTY,
        quantityReserved: 0,
        quantityAvailable: STOCK_QTY,
        reorderPoint: 5,
      },
    });
  }

  // 4) Tags
  if (tagIds.length > 0) {
    await prisma.product.update({
      where: { id: product.id },
      data: { tags: { set: tagIds.map((id) => ({ id })) } },
    });
  }

  return product;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main() {
  console.log('[posterProducts.seed] Starting 40-product poster seed...\n');

  // ---- Prerequisites ----
  const category = await getOrFail('Category: posters', () =>
    prisma.category.findUnique({ where: { slug: POSTER_CATEGORY_SLUG } }),
  );

  const store = await getOrFail('Store: demo-store', () =>
    prisma.store.findUnique({ where: { slug: DEMO_STORE_SLUG } }),
  );

  const warehouse = await getOrFail('Warehouse: WH-DEMO-01', () =>
    prisma.warehouse.findUnique({
      where: { storeId_code: { storeId: store.id, code: DEMO_WAREHOUSE_CODE } },
    }),
  );

  // Tax: try GST 12% (printed matter) or fallback to any active
  let tax = await prisma.tax.findUnique({ where: { name: 'GST 12%' } });
  if (!tax) {
    tax = await prisma.tax.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { rate: 'asc' },
    });
  }
  if (!tax) throw new Error('No tax found. Run: pnpm seed:taxes');

  const ctx = {
    storeId: store.id,
    categoryId: category.id,
    taxId: tax.id,
    warehouseId: warehouse.id,
  };

  // ---- Attributes (for variable products) ----
  console.log('  Setting up attributes...');
  const sizeAttr = await ensureAttribute(
    'Poster Size',
    'poster-size',
    SIZES.map((v, i) => ({ value: v, slug: SIZE_SLUGS[i] })),
  );
  const frameAttr = await ensureAttribute(
    'Frame Type',
    'frame-type',
    FRAMES.map((v, i) => ({ value: v, slug: FRAME_SLUGS[i] })),
  );
  const finishAttr = await ensureAttribute(
    'Print Finish',
    'print-finish',
    FINISHES.map((v, i) => ({ value: v, slug: FINISH_SLUGS[i] })),
  );
  const attrRegistry: AttrRegistry = {
    size: sizeAttr,
    frame: frameAttr,
    finish: finishAttr,
  };

  // ---- Collect unique tags ----
  console.log('  Ensuring tags...');
  const allTagNames = new Set<string>();
  for (const p of PRODUCTS) {
    for (const t of p.tags) allTagNames.add(t);
  }
  const tagMap = new Map<string, string>(); // name → id
  for (const name of allTagNames) {
    tagMap.set(name, await ensureTag(name));
  }

  // ---- Seed products ----
  let simpleCount = 0;
  let variableCount = 0;
  let totalVariants = 0;

  for (const p of PRODUCTS) {
    const tagIds = p.tags.map((t) => tagMap.get(t)!);

    if (p.productType === 'SIMPLE') {
      await createSimpleProduct(p, ctx, tagIds);
      simpleCount++;
      totalVariants++;
      process.stdout.write(`  ✓ [SIMPLE]   ${p.name}\n`);
    } else {
      await createVariableProduct(p, ctx, tagIds, attrRegistry);
      variableCount++;
      // Count variants created
      const varCount = await prisma.productVariant.count({
        where: { product: { slug: p.slug } },
      });
      totalVariants += varCount;
      process.stdout.write(`  ✓ [VARIABLE] ${p.name} (${varCount} variants)\n`);
    }
  }

  // ---- Summary ----
  console.log('\n[posterProducts.seed] Done!\n');
  console.log(`  Category : ${category.name} (slug: ${category.slug})`);
  console.log(`  Store    : ${store.name} (slug: ${store.slug})`);
  console.log(`  Tax      : ${tax.name} (${tax.rate}%)`);
  console.log(`  Products : ${PRODUCTS.length} total`);
  console.log(`    SIMPLE   : ${simpleCount}`);
  console.log(`    VARIABLE : ${variableCount}`);
  console.log(`  Variants : ${totalVariants} total (all stocked with ${STOCK_QTY} units)`);
  console.log(`  Tags     : ${allTagNames.size} ensured`);
  console.log(`  Attributes: Poster Size (${SIZES.length}), Frame Type (${FRAMES.length}), Print Finish (${FINISHES.length})`);
  console.log(`  Images   : placeholder (picsum.photos)`);
}

main()
  .catch((e) => {
    console.error('[posterProducts.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
