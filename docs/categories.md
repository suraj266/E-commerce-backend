# Marketplace Category Tree

Comprehensive 3-4 level category hierarchy for an Indian multi-category marketplace.
Modelled on **Amazon.in** + **Flipkart** + India-specific buckets (Sarees, Pooja items,
Ayurveda, Organic foods, Two-wheelers, etc.).

This file is the **source of truth** for `prisma/seed/categories.seed.ts`. Each leaf
node is where products attach. Spec templates (Sprint 2.7) hang off leaves with
fall-back inheritance to ancestors.

---

## Conventions

| Level | Markdown | Meaning |
|------:|----------|---------|
| L1 | `# 1. Electronics` | Department — top of the browse tree |
| L2 | `## 1.1 Mobiles & Accessories` | Sub-department |
| L3 | `- Smartphones` | Leaf — products attach here |
| L4 | `  - Foldable Phones` | Variant leaf (used sparingly, only where the same L3 holds genuinely distinct sub-products) |

Slugs are auto-generated at seed time: lowercase, `&` → `and`, spaces → `-`,
strip non-alphanumerics. Stored explicitly so URLs are stable.

Counts at the bottom of this file.

---

# 1. Electronics

## 1.1 Mobiles & Accessories
- Smartphones
- Feature Phones
- Foldable Phones
- Refurbished Phones
- Mobile Cases & Covers
- Screen Protectors & Tempered Glass
- Power Banks
- Chargers & Adapters
- Cables (USB / Lightning / Type-C)
- Mobile Holders & Mounts
- Selfie Sticks & Tripods
- Stylus Pens
- OTG Adapters
- Memory Cards & Storage
- Mobile Repair & Replacement Parts
- SIM Tools & Ejectors

## 1.2 Audio
- Wired Headphones
- Wired Earphones
- True Wireless Earbuds
- Bluetooth Headphones (Over-ear / On-ear)
- Bluetooth Speakers
- Soundbars
- Home Theater Systems
- Hi-Fi & Stereo
- Microphones (Studio / Lavalier / USB)
- Audio Interfaces & Mixers
- Turntables & Vinyl

## 1.3 Computers & Laptops
- Laptops (Windows)
- MacBooks
- 2-in-1 Convertibles
- Gaming Laptops
- Desktops
- All-in-One PCs
- Mini PCs & NUCs
- Workstations
- Refurbished Computers
- Laptop Bags & Sleeves
- Laptop Stands & Cooling Pads
- Laptop Skins & Decals

## 1.4 Computer Accessories & Peripherals
- Keyboards (Wired / Wireless / Mechanical)
- Mice & Trackpads
- Monitors
- Webcams
- USB Hubs & Docking Stations
- External Hard Drives
- SSDs & Internal Drives
- USB Flash Drives
- Headsets
- Graphics Tablets

## 1.5 Networking & WiFi
- Wi-Fi Routers
- Wi-Fi Mesh Systems
- Wi-Fi Range Extenders
- Modems
- Network Switches
- Ethernet Cables
- Powerline Adapters
- Network Cards (PCIe / USB)
- VPN Routers

## 1.6 Printers, Scanners & Office Tech
- Inkjet Printers
- Laser Printers
- All-in-One Printers
- 3D Printers
- Scanners
- Printer Inks & Toners
- Print Paper
- Shredders
- Label Makers
- Barcode Scanners
- Cash Registers & POS

## 1.7 TV & Home Entertainment
- LED TVs
- QLED TVs
- OLED TVs
- Smart TVs (Android / Google / Fire / Roku)
- 4K & 8K TVs
- Projectors
- Streaming Devices (Fire Stick / Chromecast / Apple TV)
- TV Mounts & Stands
- Remote Controls
- Set-Top Boxes
- AV Receivers

## 1.8 Cameras & Photography
- DSLR Cameras
- Mirrorless Cameras
- Point & Shoot Cameras
- Action Cameras
- Instant Cameras
- Drones & Aerial Photography
- Camera Lenses
- Tripods & Monopods
- Gimbals & Stabilizers
- Camera Bags
- Camera Memory Cards
- Camera Batteries & Chargers
- Lighting & Studio
- Filters & Lens Accessories
- Binoculars & Telescopes

## 1.9 Wearable Tech
- Smartwatches
- Fitness Bands & Trackers
- Smart Rings
- VR Headsets
- AR Glasses
- Wearable Cameras
- Smart Glasses

## 1.10 Smart Home
- Smart Speakers (Alexa / Google / HomePod)
- Smart Displays
- Smart Lighting (Bulbs / Strips / Switches)
- Smart Plugs & Power Strips
- Smart Thermostats
- Smart Locks & Doorbells
- Home Security Cameras
- Smart Sensors (Motion / Door / Leak)
- Smart Hubs & Bridges
- Robot Vacuums

## 1.11 Gaming Consoles & Accessories
- PlayStation Consoles
- Xbox Consoles
- Nintendo Consoles
- Handheld Consoles (Steam Deck / Switch Lite)
- Game Controllers
- Gaming Headsets
- Gaming Keyboards & Mice
- Gaming Chairs
- VR Gaming
- Game Capture Cards

## 1.12 PC Components
- Processors (CPUs)
- Motherboards
- Graphics Cards (GPUs)
- RAM
- Power Supplies
- PC Cases
- CPU Coolers & Fans
- Liquid Cooling
- Sound Cards
- Optical Drives

## 1.13 Refurbished & Open-Box
- Refurbished Phones
- Refurbished Laptops
- Refurbished TVs
- Refurbished Appliances

---

# 2. Home & Kitchen

## 2.1 Cookware
- Pressure Cookers
- Tawas & Griddles
- Kadhais & Woks
- Frying Pans
- Saucepans
- Stockpots & Casseroles
- Tadka Pans
- Idli / Dhokla / Modak Makers
- Roti & Naan Makers (Manual)
- Cookware Sets

## 2.2 Bakeware
- Cake Tins & Moulds
- Loaf Pans
- Cookie Sheets
- Muffin & Cupcake Pans
- Cooling Racks
- Rolling Pins
- Pastry Brushes
- Silicone Mats

## 2.3 Dining & Serveware
- Dinner Sets
- Plates (Steel / Ceramic / Melamine)
- Bowls
- Cups & Mugs
- Glasses & Tumblers
- Serving Bowls
- Serving Trays
- Bone China & Fine Dining

## 2.4 Cutlery & Kitchen Tools
- Knives & Knife Sets
- Chopping Boards
- Spoons & Ladles
- Spatulas
- Tongs
- Whisks & Beaters
- Graters & Peelers
- Strainers & Sieves
- Measuring Cups & Spoons
- Can Openers
- Choppers & Slicers
- Mortar & Pestle (Sil Batta / Khalbatta)

## 2.5 Storage & Containers
- Kitchen Storage Containers (Steel / Plastic / Glass)
- Spice Racks & Masala Boxes
- Tiffin Boxes & Lunch Boxes
- Casseroles (Insulated)
- Vacuum Flasks
- Water Bottles
- Sippers
- Jars & Canisters
- Cling Wrap & Foil
- Vacuum Sealers

## 2.6 Bar & Glassware
- Wine Glasses
- Cocktail & Whisky Glasses
- Beer Mugs
- Bar Tools & Mixers
- Decanters
- Ice Buckets
- Cocktail Shakers

## 2.7 Coffee & Tea
- Tea Pots & Kettles
- Coffee Makers (Manual / French Press)
- Coffee Grinders
- Tea Strainers
- Mugs & Cups
- Tea Caddies & Storage
- Espresso Machines (non-electric)

## 2.8 Bed & Bath
- Bedsheets
- Pillow Covers
- Pillows
- Cushions & Cushion Covers
- Blankets
- Quilts & Comforters
- Mattress Protectors
- Bed Skirts
- Bath Towels
- Hand Towels
- Bath Mats
- Bath Robes
- Shower Curtains
- Toilet Seat Covers

## 2.9 Curtains & Drapes
- Window Curtains
- Door Curtains
- Sheer Curtains
- Blackout Curtains
- Curtain Rods & Tracks
- Curtain Holdbacks

## 2.10 Storage & Organization
- Wardrobes (Foldable / Plastic)
- Shoe Racks
- Closet Organizers
- Storage Boxes & Bins
- Hangers
- Vacuum Storage Bags
- Drawer Organizers
- Under-bed Storage
- Wall Hooks & Hangers

## 2.11 Cleaning Supplies (Tools)
- Brooms
- Mops & Wipers
- Buckets & Mugs
- Dustbins
- Cleaning Brushes
- Microfiber Cloths
- Sponges & Scrubbers
- Toilet Brushes

## 2.12 Carpets & Rugs
- Living Room Carpets
- Bedroom Rugs
- Door Mats
- Bath Mats
- Yoga Mats
- Carpet Padding

---

# 3. Home Decor & Festive

## 3.1 Wall Decor
- Wall Paintings
- Canvas Prints
- Posters
- Wall Stickers & Decals
- Wall Murals & Wallpaper
- Wall Clocks
- Mirrors (Decorative)
- Photo Frames
- Wall Shelves
- Wall Plates & Plaques
- Religious Wall Hangings
- Tapestries

## 3.2 Showpieces & Figurines
- Idols (Brass / Marble / Wood)
- Decorative Bowls & Plates
- Vases
- Showpiece Animals & Birds
- Decorative Bottles
- Showpiece Boxes
- Bookends
- Decorative Trays

## 3.3 Candles & Aromatics
- Pillar Candles
- Tealight Candles
- Scented Candles
- Floating Candles
- Candle Holders
- Diyas
- Incense Sticks (Agarbatti)
- Dhoop & Dhoop Stands
- Aroma Diffusers
- Essential Oils

## 3.4 Indoor Plants & Planters
- Live Indoor Plants
- Artificial Plants
- Bonsai
- Succulents
- Plant Pots (Ceramic / Plastic / Terracotta)
- Hanging Planters
- Self-watering Pots
- Plant Stands

## 3.5 Festive & Seasonal Decor
- Diwali Decor (Toran / Rangoli / Lights)
- Christmas Decor (Tree / Ornaments / Stockings)
- Holi Supplies
- Rakhi & Threads
- Eid Decor
- Wedding Decor (Mandap / Garlands)
- Birthday & Party Decor
- Balloons & Confetti
- Bunting & Banners

## 3.6 Photo Frames & Albums
- Single Photo Frames
- Collage Frames
- Personalized Frames
- Photo Albums

## 3.7 Wind Chimes & Hangings
- Wind Chimes
- Door Hangings (Toran)
- Dream Catchers
- Hanging Decoratives

---

# 4. Lighting

## 4.1 Bulbs & LEDs
- LED Bulbs
- Smart Bulbs
- CFL Bulbs
- Halogen Bulbs
- Tube Lights
- LED Strips
- Decorative Bulbs

## 4.2 Lamps
- Table Lamps
- Floor Lamps
- Bedside Lamps
- Study Lamps
- Reading Lamps
- Salt Lamps

## 4.3 Ceiling & Wall Lights
- Ceiling Lights
- Pendant Lights
- Chandeliers
- Wall Sconces
- Picture Lights

## 4.4 Decorative Lighting
- Fairy Lights & String Lights
- Festoon Lights
- Lanterns
- Paper Lamps
- Diya Stands
- Outdoor String Lights

## 4.5 Outdoor & Path Lights
- Garden Lights
- Solar Path Lights
- Flood Lights
- Spotlights
- Wall Pack Lights

---

# 5. Furniture

## 5.1 Living Room
- Sofas (2-seater / 3-seater / L-shaped)
- Sofa Cum Beds
- Recliners
- Coffee Tables
- Side Tables
- TV Units
- Bean Bags
- Ottomans & Footstools
- Console Tables

## 5.2 Bedroom
- Single Beds
- Double Beds
- Queen Size Beds
- King Size Beds
- Hydraulic Storage Beds
- Mattresses (Foam / Spring / Latex / Coir)
- Mattress Toppers
- Wardrobes
- Dressing Tables
- Bedside Tables
- Bedroom Sets

## 5.3 Dining
- Dining Sets (4 / 6 / 8 seater)
- Dining Tables
- Dining Chairs
- Dining Benches
- Bar Stools
- Bar Cabinets

## 5.4 Office & Study
- Office Chairs
- Executive Chairs
- Gaming Chairs
- Office Tables
- Study Tables
- Computer Tables
- Office Cabins & Cubicles
- Bookshelves
- File Cabinets

## 5.5 Kids' Furniture
- Kids' Beds
- Bunk Beds
- Kids' Study Tables
- Kids' Storage
- Toy Storage Cabinets

## 5.6 Outdoor Furniture
- Garden Chairs
- Garden Benches
- Hammocks
- Swing Chairs
- Patio Sets
- Outdoor Tables
- Sun Loungers

---

# 6. Appliances

## 6.1 Large Appliances
- Refrigerators (Single / Double / Triple Door / Side-by-Side)
- Washing Machines (Top Load / Front Load / Semi-Automatic)
- Dryers
- Dishwashers
- Air Conditioners (Window / Split / Inverter / Cassette)
- Range Hoods & Chimneys

## 6.2 Microwaves & Ovens
- Microwave Ovens (Solo / Grill / Convection)
- OTGs
- Built-in Ovens
- Steam Ovens

## 6.3 Kitchen Appliances
- Mixer Grinders
- Wet Grinders
- Food Processors
- Hand Blenders
- Juicers (Centrifugal / Cold Press)
- Blenders
- Induction Cooktops
- Gas Stoves
- Air Fryers
- Electric Kettles
- Coffee Makers (Espresso / Drip / Capsule)
- Toasters & Sandwich Makers
- Roti Makers (Electric)
- Rice Cookers
- Slow Cookers
- Pressure Cookers (Electric)
- Egg Boilers
- Popcorn Makers
- Yogurt & Curd Makers
- Ice Cream Makers

## 6.4 Personal Care Appliances
- Hair Dryers
- Hair Straighteners
- Hair Curlers
- Trimmers (Beard / Body)
- Shavers (Electric)
- Epilators
- Electric Toothbrushes
- Water Flossers
- Massagers
- Foot Spas

## 6.5 Heating & Cooling
- Air Coolers (Personal / Tower / Desert)
- Ceiling Fans
- Pedestal Fans
- Table Fans
- Wall Fans
- Exhaust Fans
- Tower Fans
- Room Heaters (Halogen / Oil / Convection)
- Geysers (Storage / Instant)
- Air Purifiers
- Dehumidifiers
- Humidifiers

## 6.6 Water Solutions
- Water Purifiers (RO / UV / UF)
- Water Dispensers
- Water Filters

## 6.7 Cleaning Appliances
- Vacuum Cleaners (Upright / Cylinder / Robot / Handheld)
- Steam Cleaners
- Pressure Washers
- Carpet Cleaners

## 6.8 Sewing & Tailoring
- Sewing Machines
- Embroidery Machines
- Overlock Machines

---

# 7. Beauty & Personal Care

## 7.1 Skincare
- Face Wash & Cleansers
- Moisturizers (Day / Night)
- Sunscreens
- Face Serums
- Face Masks & Sheets
- Toners
- Lip Balms & Lip Care
- Body Lotions & Creams
- Eye Creams
- Anti-Aging Products
- Acne Treatment
- Body Oils

## 7.2 Hair Care
- Shampoos
- Conditioners
- Hair Oils
- Hair Masks
- Hair Serums
- Hair Color
- Hair Spray
- Heat Protection
- Anti-Dandruff Care
- Hair Loss Treatment
- Dry Shampoo

## 7.3 Makeup
- Lipsticks & Lip Glosses
- Foundations
- BB & CC Creams
- Concealers
- Compact & Powder
- Highlighter & Bronzer
- Blush
- Eye Liner
- Kajal
- Mascara
- Eye Shadow
- Eyebrow Pencils
- Nail Polish
- Nail Care (Cuticle / Strengtheners)
- Makeup Removers
- Makeup Brushes & Tools
- Makeup Kits

## 7.4 Fragrances
- Men's Perfumes
- Women's Perfumes
- Unisex Perfumes
- Deodorants & Body Sprays
- Body Mists
- Attars (Alcohol-free)
- Roll-on Deodorants
- Talcum Powder

## 7.5 Bath & Body
- Soaps (Bath / Beauty)
- Body Wash & Shower Gels
- Hand Wash
- Bubble Bath & Bath Salts
- Body Scrubs
- Loofahs & Bath Sponges
- Hair Removal (Wax / Cream / Razor)

## 7.6 Men's Grooming
- Beard Oils & Balms
- Beard Wash
- Shaving Creams & Foams
- After Shave
- Razors & Blades
- Men's Skincare
- Men's Face Wash

## 7.7 Oral Care
- Toothpaste
- Toothbrushes (Manual)
- Mouthwash
- Dental Floss
- Tongue Cleaners
- Whitening Products

## 7.8 Tools & Accessories
- Hair Brushes & Combs
- Hair Accessories (Bands / Clips / Bobby Pins)
- Makeup Mirrors
- Makeup Bags & Cases
- Tweezers & Scissors

---

# 8. Health, Household & Pharmacy

## 8.1 Health Devices
- Thermometers (Digital / IR)
- BP Monitors
- Glucometers (& Strips)
- Pulse Oximeters
- Weighing Scales
- Body Composition Monitors
- Nebulizers
- Steamers & Inhalers
- Hot & Cold Packs
- Heating Pads
- Mobility Aids (Walking Sticks / Walkers / Wheelchairs)

## 8.2 Vitamins & Supplements
- Multivitamins
- Vitamin C / D / B12
- Calcium & Magnesium
- Iron Supplements
- Omega-3 & Fish Oil
- Probiotics
- Joint Care
- Eye Health
- Sleep & Stress Aids

## 8.3 Pain Relief & First Aid
- Pain Relief Sprays & Balms
- Pain Patches
- Bandages
- Antiseptic Solutions
- First Aid Kits
- Wound Care
- Muscle Relief

## 8.4 Cough, Cold & Flu
- Cough Syrups
- Vapor Rubs
- Throat Lozenges
- Decongestants
- Inhalers (OTC)

## 8.5 Diabetes & Heart Care
- Glucose Monitors & Strips
- Insulin Pen Needles
- Sugar-free Sweeteners
- Diabetic Foods
- Heart Health Supplements

## 8.6 Ayurveda & Wellness
- Chyawanprash
- Ayurvedic Tonics
- Triphala & Churnas
- Patanjali / Dabur / Himalaya Products
- Homeopathy
- Massage Oils (Ayurvedic)
- Honey & Health Foods

## 8.7 Sexual Wellness
- Condoms
- Lubricants
- Pregnancy Test Kits
- Ovulation Kits
- Personal Massagers

## 8.8 Personal Hygiene
- Sanitary Pads
- Tampons
- Menstrual Cups
- Adult Diapers
- Hand Sanitizers
- Wet Wipes
- Tissue Paper
- Toilet Paper

## 8.9 Household Cleaning
- Detergent Powders & Liquids
- Detergent Pods
- Fabric Softeners
- Bleach
- Floor Cleaners
- Toilet Cleaners
- Bathroom Cleaners
- Glass & Surface Cleaners
- Dishwash Liquid & Bars
- Dishwasher Detergent
- Air Fresheners
- Insect Repellents (Sprays / Coils / Mats)
- Pest Control

## 8.10 Sports Nutrition & Fitness Diet
- Whey Protein
- Mass Gainers
- BCAA & Amino Acids
- Pre-Workouts
- Creatine
- Protein Bars
- Meal Replacements
- Health Drinks (Horlicks / Bournvita / Boost)

---

# 9. Grocery & Gourmet Foods

## 9.1 Staples & Pantry
- Rice (Basmati / Sona Masoori / Brown / Sticky)
- Atta & Flours (Wheat / Multigrain / Bajra / Jowar / Maida / Besan)
- Dals & Pulses
- Cooking Oils (Sunflower / Mustard / Olive / Coconut / Groundnut / Sesame)
- Ghee
- Sugar & Sugar Substitutes
- Salt (Iodized / Rock / Pink Himalayan / Black)
- Jaggery & Honey
- Sooji & Rava
- Poha & Beaten Rice
- Vermicelli & Sevai

## 9.2 Dairy & Eggs
- Milk (Cow / Buffalo / Toned / Full Cream)
- Curd & Yogurt (Plain / Flavored / Greek)
- Butter (Salted / Unsalted)
- Ghee
- Paneer
- Cheese (Cheddar / Mozzarella / Processed Slices)
- Cream
- Buttermilk & Lassi
- Eggs (White / Brown / Free-range)
- Tofu
- Plant-based Milk (Almond / Soy / Oat)
- Cheese Spreads

## 9.3 Snacks & Munchies
- Chips & Wafers
- Namkeen & Bhujia
- Biscuits & Cookies
- Crackers
- Khakhra
- Roasted Snacks
- Healthy Snacks (Baked / Roasted)
- Imported Snacks
- Popcorn
- Trail Mixes & Granola

## 9.4 Chocolates & Sweets
- Chocolate Bars
- Chocolate Boxes
- Premium Chocolates
- Indian Sweets / Mithai
- Dragees & Candies
- Toffees
- Mouth Fresheners

## 9.5 Dry Fruits & Nuts
- Almonds
- Cashews
- Walnuts
- Pistachios
- Raisins (Black / Green / Golden)
- Dates
- Figs (Anjeer)
- Hazelnuts
- Peanuts
- Mixed Dry Fruits
- Seeds (Chia / Flax / Pumpkin / Sunflower)

## 9.6 Beverages
- Tea (Black / Green / Herbal / Masala / Iced)
- Coffee (Instant / Filter / Beans / Cold Brew)
- Fruit Juices
- Soft Drinks
- Energy Drinks
- Sports Drinks
- Coconut Water
- Soda & Mixers
- Iced Tea
- Health Drinks

## 9.7 Bakery
- Breads (White / Whole Wheat / Multigrain / Pav)
- Buns
- Cakes (Pre-packaged)
- Pastries
- Rusks & Toast

## 9.8 Cooking Essentials & Condiments
- Sauces & Ketchup
- Pickles & Chutneys
- Vinegars (White / Apple Cider / Balsamic)
- Cooking Pastes (Ginger-Garlic / Tamarind)
- Mayonnaise
- Salad Dressings
- Mustard
- Soya Sauce
- Cooking Wine

## 9.9 Spices & Masalas
- Whole Spices (Cumin / Coriander / Cinnamon / Cloves / Cardamom)
- Ground Spices (Turmeric / Chili / Coriander / Cumin Powder)
- Garam Masala
- Pickle Masala
- Ready Masala Mixes (Sambar / Pav Bhaji / Chaat / Biryani)
- Salt Mixes
- Saffron (Kesar)

## 9.10 Frozen & Instant Foods
- Frozen Vegetables
- Frozen Meat & Seafood
- Frozen Snacks
- Frozen Parathas
- Ready to Eat Meals
- Instant Noodles
- Pasta & Spaghetti
- Ready Soups
- Heat & Eat Curries
- Microwave Meals

## 9.11 Breakfast Foods
- Cornflakes & Cereals
- Oats (Plain / Flavored)
- Muesli
- Granola
- Pancake Mix
- Idli / Dosa Batter
- Breakfast Bars

## 9.12 Organic & Natural Foods
- Organic Pulses
- Organic Atta & Flours
- Organic Spices
- Organic Oils & Ghee
- Organic Sweeteners (Jaggery / Honey)
- Organic Snacks
- Organic Tea & Coffee
- Organic Dairy
- Organic Honey
- Cold-Pressed Oils
- Millets (Ragi / Bajra / Jowar / Foxtail)
- Gluten-Free Products
- Vegan Products

## 9.13 International / Gourmet
- Olive Oils & Specialty Oils
- Imported Pastas
- International Sauces
- Specialty Cheeses
- Gourmet Tea & Coffee
- Maple Syrup
- Truffle Products
- International Snacks

## 9.14 Meat, Seafood & Eggs (Where Allowed)
- Chicken (Fresh / Frozen)
- Mutton & Lamb
- Fish & Seafood
- Prawns
- Crab
- Cold Cuts & Sausages
- Eggs

## 9.15 Gift Hampers
- Sweet Hampers
- Dry Fruit Hampers
- Festival Hampers (Diwali / Rakhi / Christmas)
- Corporate Gift Hampers

---

# 10. Baby & Mother Care

## 10.1 Diapers & Wipes
- Diapers (Newborn / S / M / L / XL / XXL)
- Pant-Style Diapers
- Cloth Diapers
- Baby Wipes
- Diaper Rash Cream
- Changing Mats

## 10.2 Baby Skincare
- Baby Lotions
- Baby Oils & Massage Oils
- Baby Powder
- Baby Soap
- Baby Shampoo
- Baby Sunscreen

## 10.3 Baby Feeding
- Baby Bottles
- Sippy Cups
- Bottle Sterilizers
- Bottle Warmers
- Breast Pumps
- Nursing Pads
- Bibs
- Burp Cloths
- High Chairs
- Booster Seats

## 10.4 Baby Food & Formula
- Infant Formula
- Follow-up Formula
- Baby Cereals
- Baby Snacks (Puffs / Biscuits)
- Baby Drinks
- Toddler Foods

## 10.5 Strollers & Travel
- Strollers
- Prams
- Baby Carriers
- Car Seats
- Baby Safety Belts

## 10.6 Nursery
- Cribs & Cots
- Baby Bassinets
- Bedding Sets
- Nursing Pillows
- Mosquito Nets
- Baby Monitors
- Night Lamps

## 10.7 Maternity & Pregnancy
- Maternity Wear
- Nursing Bras
- Maternity Pillows
- Stretch Mark Creams
- Pregnancy Tests
- Prenatal Vitamins
- Baby Books & Journals

## 10.8 Toys & Activity
- Baby Rattles
- Teethers
- Activity Gyms
- Baby Walkers
- Soft Toys (Infant)
- Baby Books

---

# 11. Toys, Games & Hobbies

## 11.1 Toys by Age
- Toys (0-1 year)
- Toys (1-3 years)
- Toys (3-5 years)
- Toys (5-8 years)
- Toys (8+ years)

## 11.2 Educational & STEM
- Building Blocks (Lego / Mega Bloks)
- Construction Sets
- Science Kits
- Robotics Kits
- Coding Toys
- Puzzles (Jigsaw / 3D)
- Educational Workbooks
- Globes & Maps
- Microscope Kits

## 11.3 Soft Toys & Plush
- Teddy Bears
- Plush Animals
- Character Plush
- Rag Dolls
- Cushion Toys

## 11.4 Dolls & Action Figures
- Fashion Dolls (Barbie etc.)
- Indian Dolls
- Action Figures (Marvel / DC / Anime)
- Doll Houses
- Doll Accessories

## 11.5 Outdoor Play
- Cycles (Kids')
- Tricycles
- Skateboards (Kids')
- Roller Skates
- Trampolines
- Slides & Swings
- Outdoor Sports Toys
- Kites
- Sand & Water Play

## 11.6 Remote Control Toys
- RC Cars
- RC Helicopters
- RC Drones (Kids)
- RC Boats

## 11.7 Board & Card Games
- Monopoly & Family Games
- Carrom
- Chess Sets
- Ludo & Snakes-and-Ladders
- Card Games (UNO / Taash)
- Strategy Games
- Trivia Games

## 11.8 Arts & Crafts for Kids
- Coloring Books
- Crayons & Markers
- Sticker Books
- Play-Doh & Modeling Clay
- Sketch & Drawing Kits

## 11.9 Hobbies & Collectibles
- Model Building Kits (Cars / Planes / Ships)
- Trains & Tracks
- Kite Making
- Magic Kits
- Coin & Stamp Collections

## 11.10 Pretend Play
- Kitchen Sets
- Doctor Sets
- Tool Sets (Toy)
- Dress-up Costumes
- Toy Cash Registers

---

# 12. Pet Supplies

## 12.1 Dogs
- Dog Food (Dry / Wet / Raw)
- Dog Treats & Bones
- Dog Toys (Chew / Fetch / Plush)
- Leashes & Collars
- Harnesses
- Beds & Crates
- Bowls & Feeders
- Grooming (Shampoo / Brushes / Clippers)
- Health Care (Tick & Flea / Vitamins)
- Training Aids
- Carriers & Travel
- Apparel & Costumes

## 12.2 Cats
- Cat Food (Dry / Wet)
- Cat Treats
- Cat Litter & Trays
- Cat Toys
- Cat Trees & Scratchers
- Beds & Hideouts
- Grooming
- Health Care

## 12.3 Birds
- Bird Food
- Cages
- Perches & Toys
- Health Care

## 12.4 Aquarium & Fish
- Fish Food
- Aquariums
- Filters & Pumps
- Aquarium Decor
- Heaters & Lighting
- Water Treatment

## 12.5 Small Pets (Hamster / Rabbit / Guinea Pig)
- Small Pet Food
- Cages
- Bedding
- Toys

## 12.6 Reptiles
- Reptile Food
- Terrariums
- Heating & Lighting

---

# 13. Clothing & Apparel

## 13.1 Men's Clothing
- T-Shirts & Polos
- Shirts (Casual / Formal)
- Jeans
- Trousers & Chinos
- Cargo Pants
- Shorts
- Track Pants & Joggers
- Innerwear (Briefs / Trunks / Vests)
- Loungewear & Pyjamas
- Suits & Blazers
- Waistcoats
- Sweaters & Cardigans
- Sweatshirts & Hoodies
- Jackets (Bomber / Denim / Leather / Puffer)
- Coats & Overcoats
- Sportswear (Activewear)
- Swim Trunks
- Ethnic — Kurtas & Kurta Sets
- Ethnic — Sherwanis
- Ethnic — Dhoti / Mundu
- Ethnic — Jodhpuri Suits
- Ethnic — Nehru Jackets

## 13.2 Women's Clothing
- Tops & Tunics
- Shirts & Blouses
- T-Shirts
- Tank Tops & Camisoles
- Dresses (Casual / Party / Maxi / Mini)
- Skirts
- Jeans
- Trousers & Pants
- Leggings & Jeggings
- Shorts
- Track Pants & Joggers
- Innerwear & Lingerie
- Nightwear
- Sportswear
- Sweaters & Cardigans
- Sweatshirts & Hoodies
- Jackets & Coats
- Swimwear
- Ethnic — Sarees (Silk / Cotton / Banarasi / Kanjivaram / Designer)
- Ethnic — Salwar Suits
- Ethnic — Kurtas & Kurtis
- Ethnic — Lehengas
- Ethnic — Anarkali Suits
- Ethnic — Sharara & Gharara
- Ethnic — Dupattas & Stoles
- Ethnic — Blouses

## 13.3 Kids' Clothing
- Boys' Clothing (T-Shirts / Shirts / Jeans / Shorts)
- Girls' Clothing (Tops / Frocks / Skirts / Leggings)
- Infant & Newborn Clothing
- Kids' Ethnic Wear
- School Uniforms

## 13.4 Winter Wear
- Thermal Innerwear
- Fleece Jackets
- Down Jackets
- Mufflers & Scarves
- Gloves
- Caps & Beanies
- Shawls

---

# 14. Shoes & Footwear

## 14.1 Men's Footwear
- Casual Shoes
- Sports Shoes
- Running Shoes
- Formal Shoes
- Loafers & Mocassins
- Sandals & Floaters
- Flip Flops
- Boots (Chukka / Chelsea / Hiking)
- Ethnic Footwear (Mojaris / Kolhapuris)
- Slippers (Indoor)

## 14.2 Women's Footwear
- Heels (Stilettos / Block / Wedge / Pumps)
- Flats & Ballerinas
- Sandals
- Sports Shoes
- Running Shoes
- Boots (Ankle / Knee-high)
- Casual Shoes
- Ethnic Footwear (Juttis / Mojaris)
- Slippers
- Flip Flops

## 14.3 Kids' Footwear
- Boys' Shoes
- Girls' Shoes
- School Shoes
- Sports Shoes (Kids)
- Sandals (Kids)
- Slippers (Kids)

## 14.4 Footwear Accessories
- Insoles
- Shoe Care (Polish / Cleaners)
- Shoe Bags
- Shoe Trees & Stretchers

---

# 15. Bags, Wallets & Luggage

## 15.1 Backpacks
- Casual Backpacks
- Laptop Backpacks
- College Backpacks
- Trekking Backpacks
- Rolltop Backpacks
- Anti-theft Backpacks

## 15.2 Handbags & Purses
- Handbags
- Tote Bags
- Sling Bags & Crossbody
- Clutches
- Hobo Bags
- Satchels
- Mini Bags

## 15.3 Wallets
- Men's Wallets
- Women's Wallets
- Card Holders
- Money Clips
- Coin Purses

## 15.4 Travel Luggage
- Cabin Trolleys
- Check-in Trolleys
- Hard-shell Suitcases
- Soft-shell Suitcases
- Duffel Bags
- Travel Backpacks
- Garment Bags
- Travel Pouches
- Toiletry Kits

## 15.5 Briefcases & Office Bags
- Briefcases
- Messenger Bags
- Laptop Bags
- Document Holders

---

# 16. Jewellery

## 16.1 Fine Jewellery — Gold
- Gold Earrings
- Gold Necklaces
- Gold Pendants
- Gold Rings
- Gold Bracelets
- Gold Bangles
- Gold Mangalsutra
- Gold Chains
- Gold Coins & Bars
- Gold Nose Pins

## 16.2 Fine Jewellery — Diamond
- Diamond Earrings
- Diamond Necklaces
- Diamond Rings
- Diamond Pendants
- Diamond Bracelets

## 16.3 Fine Jewellery — Silver
- Silver Earrings
- Silver Necklaces
- Silver Rings
- Silver Bracelets
- Silver Anklets
- Silver Toe Rings
- Silver Coins
- Silver Idols

## 16.4 Fine Jewellery — Platinum
- Platinum Rings
- Platinum Chains
- Platinum Earrings

## 16.5 Fashion / Costume Jewellery
- Earrings (Studs / Hoops / Drops / Jhumkas)
- Necklaces & Pendants
- Rings (Cocktail / Statement)
- Bracelets & Cuffs
- Anklets
- Bangles & Kadas
- Mangtikas
- Nose Rings
- Toe Rings
- Hair Accessories
- Body Jewellery

## 16.6 Men's Jewellery
- Men's Chains
- Men's Bracelets
- Men's Rings
- Men's Earrings
- Cufflinks
- Tie Pins
- Brooches

## 16.7 Wedding & Bridal Jewellery
- Bridal Sets
- Kundan Sets
- Polki Sets
- Temple Jewellery
- Maang Tikka Sets

---

# 17. Watches

## 17.1 Men's Watches
- Analog
- Digital
- Chronograph
- Luxury / Premium
- Casual
- Formal
- Sports

## 17.2 Women's Watches
- Analog
- Digital
- Bracelet Watches
- Fashion Watches
- Luxury / Premium

## 17.3 Couple Watches

## 17.4 Smartwatches & Wearables
- Apple Watches
- Android Smartwatches
- Hybrid Smartwatches
- Kids' Smartwatches
- Fitness Bands

## 17.5 Watch Accessories
- Watch Straps & Bands
- Watch Boxes
- Watch Tools & Care

---

# 18. Eyewear

## 18.1 Sunglasses
- Men's Sunglasses
- Women's Sunglasses
- Aviators
- Wayfarers
- Round
- Cat-Eye
- Sports Sunglasses
- Polarized Sunglasses
- Kids' Sunglasses

## 18.2 Eyeglasses (Prescription Frames)
- Men's Eyeglasses
- Women's Eyeglasses
- Kids' Eyeglasses
- Reading Glasses
- Computer / Blue-Light Glasses
- Sports Eyeglasses

## 18.3 Contact Lenses
- Daily Disposables
- Monthly Lenses
- Colored Contact Lenses
- Toric Lenses
- Multi-focal Lenses
- Contact Lens Solutions

## 18.4 Eyewear Accessories
- Eyewear Cases
- Lens Cleaning Cloths & Sprays
- Glasses Chains

---

# 19. Sports, Fitness & Outdoors

## 19.1 Cricket
- Cricket Bats
- Cricket Balls
- Batting Pads & Gloves
- Wicket Keeping Gear
- Helmets
- Cricket Kit Bags
- Cricket Shoes
- Cricket Apparel

## 19.2 Football
- Footballs
- Football Boots / Studs
- Goalkeeper Gloves
- Football Kits
- Shin Guards

## 19.3 Badminton
- Badminton Rackets
- Shuttlecocks
- Badminton Bags
- Badminton Shoes

## 19.4 Tennis
- Tennis Rackets
- Tennis Balls
- Tennis Shoes
- Tennis Bags

## 19.5 Table Tennis
- TT Rackets
- TT Balls
- TT Tables
- TT Nets

## 19.6 Other Team Sports
- Basketballs
- Volleyballs
- Hockey Sticks & Balls
- Rugby
- Baseball

## 19.7 Fitness Equipment
- Yoga Mats
- Yoga Blocks & Straps
- Resistance Bands
- Dumbbells (Fixed / Adjustable)
- Barbells & Plates
- Kettlebells
- Treadmills
- Exercise Bikes
- Elliptical Trainers
- Rowing Machines
- Skipping Ropes
- Pull-up Bars
- Push-up Bars
- Ab Rollers
- Foam Rollers
- Punching Bags
- Boxing Gloves
- Ankle Weights
- Stability Balls

## 19.8 Camping & Hiking
- Tents
- Sleeping Bags
- Camping Stoves
- Trekking Poles
- Trekking Backpacks
- Hydration Packs
- Camping Chairs
- Headlamps
- Compasses
- Multi-tools
- Survival Kits

## 19.9 Swimming
- Swimsuits (Men / Women)
- Swim Goggles
- Swim Caps
- Kickboards
- Pool Floats

## 19.10 Indoor Games
- Carrom Boards
- Chess Sets
- Snooker & Pool
- Foosball Tables
- Air Hockey

## 19.11 Adventure Sports
- Climbing Gear
- Surfing Boards
- Skateboards
- Inline Skates
- Roller Skates
- Snowboarding
- Skiing

## 19.12 Sportswear & Accessories
- Sports Bottles
- Sweat Bands
- Sports Towels
- Compression Wear
- Athletic Tape

---

# 20. Bicycles, Skates & Skateboards

## 20.1 Bicycles
- City / Hybrid Bikes
- Mountain Bikes (MTB)
- Road Bikes
- Folding Bikes
- BMX
- Kids' Bikes
- E-Bikes / Electric Cycles

## 20.2 Cycling Accessories
- Helmets
- Cycling Apparel
- Cycling Gloves
- Lights & Reflectors
- Locks
- Pumps
- Water Bottles & Cages
- Phone Mounts
- Repair Kits
- Pedals
- Saddles & Seats
- Tires & Tubes

## 20.3 Skates & Skateboards
- Skateboards
- Longboards
- Inline Skates
- Quad Skates
- Roller Skates
- Skate Helmets
- Knee & Elbow Pads

---

# 21. Books, Magazines & Comics

## 21.1 Fiction
- Indian Fiction
- International Fiction
- Crime / Thriller / Mystery
- Romance
- Historical Fiction
- Fantasy & Sci-Fi
- Literary Fiction
- Short Stories

## 21.2 Non-Fiction
- Self-Help
- Business & Management
- Biographies & Memoirs
- History
- Politics
- Psychology & Philosophy
- Science & Nature
- Travel
- Cookbooks
- Spirituality & Religion

## 21.3 Children's & Young Adult
- Picture Books
- Early Readers
- Middle-Grade
- YA Fiction
- Activity Books
- Educational Story Books

## 21.4 Academic & Textbooks
- School Textbooks (CBSE / ICSE / State Boards)
- Engineering Textbooks
- Medical Textbooks
- Law Books
- Reference Books

## 21.5 Competitive Exam Prep
- UPSC & Civil Services
- JEE & NEET
- Banking Exams
- SSC
- CAT & MBA Entrance
- GATE
- Government Job Prep

## 21.6 Comics & Manga
- Indian Comics (Tinkle / Amar Chitra Katha)
- Marvel / DC
- Manga
- Graphic Novels
- Webcomics

## 21.7 Regional Language Books
- Hindi
- Bengali
- Tamil
- Telugu
- Marathi
- Malayalam
- Kannada
- Gujarati
- Punjabi
- Urdu

## 21.8 Magazines
- Lifestyle Magazines
- Business Magazines
- News & Current Affairs
- Children's Magazines
- Specialty (Photography / Travel / Fitness)

## 21.9 Religious Books
- Bhagavad Gita
- Ramayan & Mahabharat
- Bible
- Quran
- Religious Commentaries
- Spiritual / Self-realization

---

# 22. Movies, TV & Music

## 22.1 Movies
- Bollywood (DVD / Blu-ray)
- Hollywood (DVD / Blu-ray)
- Regional Cinema
- World Cinema

## 22.2 TV Shows & Documentaries

## 22.3 Music
- CDs (Indian / International)
- Vinyl Records
- Cassettes
- Audio Books

## 22.4 Video Games
- PlayStation Games
- Xbox Games
- Nintendo Games
- PC Games
- Mobile Game Cards & Top-ups

---

# 23. Musical Instruments

## 23.1 String
- Acoustic Guitars
- Electric Guitars
- Bass Guitars
- Ukuleles
- Violins
- Cellos
- Sitar
- Veena
- Mandolins

## 23.2 Keyboards & Pianos
- Keyboards
- Digital Pianos
- Synthesizers
- Acoustic Pianos
- Harmoniums

## 23.3 Percussion
- Drum Kits
- Cajons
- Tabla
- Dholak & Dhol
- Bongos & Congas
- Hand Drums
- Cymbals

## 23.4 Wind
- Flutes (Bansuri)
- Recorders
- Saxophones
- Trumpets
- Clarinets
- Harmonica

## 23.5 DJ & Studio
- DJ Controllers
- Studio Monitors
- Audio Interfaces
- MIDI Controllers
- Headphones (Studio)

## 23.6 Accessories
- Strings & Picks
- Amps & Effects Pedals
- Cables
- Tuners
- Stands & Cases
- Sheet Music
- Music Books

---

# 24. Office & Stationery

## 24.1 Pens & Writing
- Ball Pens
- Gel Pens
- Roller Ball
- Fountain Pens
- Markers (Permanent / Whiteboard / Highlighter)
- Pencils (HB / Mechanical / Color)
- Erasers & Sharpeners

## 24.2 Paper Products
- Notebooks
- Diaries
- Journals
- Planners
- Spiral Pads
- A4 Sheets
- Sticky Notes
- Index Cards
- Photocopier Paper

## 24.3 Files & Folders
- File Folders
- Document Folders
- Box Files
- Display Books
- Ring Binders
- Sheet Protectors

## 24.4 Office Supplies
- Staplers
- Punches
- Tapes (Cellotape / Masking / Double-sided)
- Glues & Adhesives
- Scissors
- Cutters & Blades
- Calculators
- Whiteboards & Markers
- Bulletin Boards

## 24.5 Mailing & Shipping
- Envelopes
- Mailers
- Bubble Wrap
- Packing Tape
- Shipping Labels

## 24.6 School Supplies
- Geometry Boxes
- Lunch Boxes
- Water Bottles (School)
- Pencil Cases
- School Bags
- Crayons & Color Pencils
- Watercolor Sets
- Drawing Boards

## 24.7 Office Furniture (Compact)
- Desk Organizers
- Pen Stands
- Document Trays
- Cable Organizers

---

# 25. Arts, Crafts & Sewing

## 25.1 Painting
- Acrylic Paints
- Oil Paints
- Watercolor Paints
- Poster Colors
- Fabric Paints
- Spray Paints (Art)
- Brushes (Round / Flat / Detail)
- Canvas (Stretched / Rolls / Boards)
- Palettes
- Easels

## 25.2 Drawing
- Sketch Pencils
- Charcoal Pencils
- Pastels (Oil / Soft)
- Sketch Books
- Markers (Art)
- Calligraphy Pens
- Drawing Boards

## 25.3 Craft Supplies
- Craft Paper
- Cardboard
- Glue Guns
- Hot Glue Sticks
- Beads & Sequins
- Ribbons
- Quilling Strips
- Felt & Foam Sheets
- Pom Poms
- Pipe Cleaners

## 25.4 DIY Kits
- Painting Kits
- Decoupage Kits
- Origami Kits
- Resin Art Kits
- Macrame Kits
- Candle Making Kits
- Soap Making Kits

## 25.5 Sewing
- Sewing Threads
- Sewing Needles
- Pins & Cushions
- Buttons & Hooks
- Zippers
- Fabric (Cotton / Silk / Polyester)
- Sewing Patterns
- Thimbles & Tools

## 25.6 Knitting & Embroidery
- Knitting Yarn
- Knitting Needles
- Crochet Hooks
- Embroidery Threads
- Embroidery Hoops
- Cross-Stitch Kits

## 25.7 Scrapbooking
- Scrapbook Albums
- Stickers
- Washi Tapes
- Stamps & Inks
- Die-Cuts

---

# 26. Tools & Home Improvement

## 26.1 Hand Tools
- Hammers
- Screwdrivers (Sets / Individual)
- Wrenches & Spanners
- Pliers
- Tape Measures
- Levels
- Utility Knives
- Saws (Hand)
- Chisels
- Files & Rasps
- Tool Kits

## 26.2 Power Tools
- Drills (Cordless / Corded)
- Hammer Drills
- Impact Drivers
- Angle Grinders
- Circular Saws
- Jigsaws
- Reciprocating Saws
- Heat Guns
- Sanders
- Routers
- Nail Guns

## 26.3 Hardware
- Nails
- Screws
- Bolts & Nuts
- Washers
- Anchors & Wall Plugs
- Hinges
- Door Locks & Latches
- Padlocks
- Door Stoppers
- Brackets

## 26.4 Paint & Wall Treatments
- Wall Paints (Emulsion / Distemper)
- Enamels
- Primers & Putty
- Wood Polishes & Stains
- Brushes & Rollers
- Wallpapers
- Paint Trays
- Sandpaper
- Masking Tape

## 26.5 Plumbing
- Pipes & Fittings
- Faucets / Taps
- Showers & Heads
- Toilet Seats & Flush Tanks
- Wash Basins
- Drain Cleaners
- Plungers
- Hose Pipes

## 26.6 Electrical
- Switches
- Sockets
- Wires & Cables
- Extension Boards
- MCBs & Distribution Boxes
- Voltage Stabilizers
- Bulbs & Holders
- Doorbells

## 26.7 Building Materials
- Cement
- Tiles
- Bricks
- Adhesives & Sealants

## 26.8 Safety
- Safety Helmets
- Safety Gloves
- Safety Glasses
- Ear Plugs
- Dust Masks
- Hi-Viz Vests

---

# 27. Industrial & Scientific

## 27.1 Lab Equipment
- Beakers & Flasks
- Test Tubes
- Microscopes
- Lab Glassware
- pH Meters
- Lab Balances
- Pipettes
- Centrifuges

## 27.2 Material Handling
- Trolleys
- Hand Trucks
- Pallet Jacks
- Lifting Equipment

## 27.3 Industrial Hardware
- Bearings
- Belts & Pulleys
- Gears
- Springs
- Industrial Adhesives

## 27.4 Janitorial & Sanitation
- Industrial Mops
- Floor Squeegees
- Bulk Cleaners
- Trash Bags

## 27.5 Packaging Supplies
- Cardboard Boxes
- Bubble Wrap (Bulk)
- Packing Peanuts
- Strapping & Tape
- Stretch Wrap
- Custom Boxes

## 27.6 Solar & Renewable
- Solar Panels
- Solar Inverters
- Solar Batteries
- Solar Water Heaters
- Solar Lights (Outdoor)
- Solar Chargers (Portable)

## 27.7 Test & Measurement
- Multimeters
- Voltage Testers
- Calipers & Micrometers
- Stud Finders
- Laser Distance Meters

---

# 28. Garden, Lawn & Outdoor Living

## 28.1 Plants & Seeds
- Indoor Plants (Live)
- Outdoor Plants
- Flowering Plants
- Fruit Plants
- Vegetable Plants
- Bonsai
- Cactus & Succulents
- Flower Seeds
- Vegetable Seeds
- Herb Seeds
- Saplings & Bulbs

## 28.2 Planters & Pots
- Plastic Pots
- Ceramic Pots
- Terracotta Pots
- Hanging Planters
- Self-watering Pots
- Plant Stands
- Window Boxes

## 28.3 Soil & Fertilizer
- Potting Mix
- Compost
- Organic Manure
- Vermicompost
- Plant Food
- Fertilizers (NPK / Liquid)
- Pesticides & Insecticides
- Mulch

## 28.4 Gardening Tools
- Spades & Shovels
- Trowels
- Pruners & Shears
- Watering Cans
- Hose Pipes
- Sprinklers
- Sprayers
- Garden Forks
- Wheelbarrows

## 28.5 Outdoor Decor & Living
- Garden Statues
- Bird Feeders & Houses
- Outdoor Fountains
- Stepping Stones
- Garden Lights
- Wind Spinners

## 28.6 Pest Control (Garden)
- Pesticides
- Insecticides
- Fungicides
- Mole & Rodent Repellents

## 28.7 Outdoor Cooking
- BBQs & Grills
- Grilling Tools
- Charcoal & Firewood
- Outdoor Pizza Ovens

---

# 29. Automotive

## 29.1 Car Exterior
- Car Covers
- Body Covers (Custom Fit)
- Wax & Polish
- Car Wash & Cleaners
- Windshield Wipers
- Mud Flaps

## 29.2 Car Interior
- Seat Covers
- Floor Mats (Universal / Custom)
- Steering Covers
- Dashboards Covers
- Sun Shades
- Air Fresheners
- Storage Organizers
- Car Vacuum Cleaners

## 29.3 Car Electronics
- Car Stereos
- Car Speakers & Subwoofers
- Dash Cams
- GPS Navigation
- Bluetooth Adapters
- Car Chargers
- Phone Mounts

## 29.4 Car Lighting
- Headlights & Bulbs
- Tail Lights
- Fog Lamps
- LED Strips
- Reverse Camera

## 29.5 Tyres & Rims
- Car Tyres
- Tyre Inflators
- Tyre Pressure Gauges
- Wheel Covers
- Rims & Alloys

## 29.6 Lubricants & Fluids
- Engine Oil
- Transmission Fluid
- Brake Fluid
- Coolants
- Power Steering Fluid
- Windshield Washer Fluid

## 29.7 Tools & Garage
- Jump Starters
- Battery Chargers
- Jacks & Stands
- Tool Kits (Auto)
- Tow Ropes
- Repair Kits

## 29.8 Spare Parts & Replacement
- Brake Pads
- Filters (Air / Oil / Cabin)
- Spark Plugs
- Wiper Blades
- Mirrors
- Antennas

## 29.9 Roadside & Safety
- Reflective Triangles
- First Aid Kits (Auto)
- Fire Extinguishers (Auto)
- Battery Chargers

---

# 30. Two-Wheelers & Accessories

## 30.1 Helmets
- Full Face Helmets
- Half Face / Open Face
- Modular Helmets
- Off-road Helmets
- Kids' Helmets

## 30.2 Riding Gear
- Riding Jackets
- Riding Pants
- Riding Gloves
- Riding Boots
- Knee & Elbow Guards
- Body Armor

## 30.3 Bike Care
- Bike Covers
- Cleaners & Polishes
- Chain Lubes
- Fuel Additives

## 30.4 Bike Electronics
- Bike Stereos
- GPS for Bikes
- Action Cameras
- Bike Phone Mounts

## 30.5 Bike Spare Parts
- Tyres
- Brake Pads
- Chains & Sprockets
- Spark Plugs
- Filters
- Mirrors
- Lights

## 30.6 Bike Accessories
- Saddle Bags & Tank Bags
- Crash Guards
- Top Cases
- Visors
- Bike Stands
- Locks

---

# 31. Religious & Spiritual

## 31.1 Pooja Essentials
- Diyas (Brass / Clay / Silver)
- Agarbatti (Incense Sticks)
- Dhoop
- Camphor (Karpoor)
- Pooja Thalis & Plates
- Ghee Lamps
- Pooja Bells
- Puja Chowki
- Aarti Books

## 31.2 Idols & Murtis
- Brass Idols
- Marble Idols
- Wooden Idols
- Resin / Polyresin Idols
- Crystal Idols
- Silver Plated Idols

## 31.3 Religious Accessories
- Rudraksha Malas
- Tulsi Malas
- Sphatik Malas
- Pendants & Lockets (Religious)
- Yantras
- Vastu Items
- Feng Shui Items

## 31.4 Festive Pooja Items
- Ganpati Decoration
- Diwali Pooja Sets
- Navratri Items
- Karwa Chauth Sets

## 31.5 Spiritual Books
- Bhagavad Gita
- Hanuman Chalisa
- Ramayan
- Vedas & Upanishads
- Spiritual Commentaries

## 31.6 Meditation & Yoga
- Meditation Cushions
- Singing Bowls
- Meditation Beads
- Yoga Mats (Spiritual)
- Mantra Bracelets

---

# 32. Wedding, Event & Festive

## 32.1 Wedding Invitations
- Printed Cards
- Digital Invites
- Save the Date

## 32.2 Wedding Decor
- Mandap Decoration
- Garlands (Flower / Artificial)
- Wedding Stage Backdrops
- Welcome Boards
- Aisle Decorations

## 32.3 Wedding Favors
- Wedding Return Gifts
- Mehndi Favors
- Sangeet Favors

## 32.4 Party Decor
- Birthday Decoration
- Anniversary Decoration
- Baby Shower Decor
- Office Party Decor
- Theme Party Supplies

## 32.5 Balloons & Banners
- Latex Balloons
- Foil Balloons
- Number Balloons
- Banners & Buntings
- Streamers

## 32.6 Disposable Tableware
- Paper Plates
- Paper Cups
- Plastic Cutlery
- Tablecloths
- Napkins

---

# 33. Gift Cards, Subscriptions & Vouchers

## 33.1 Gift Cards
- E-Gift Cards
- Physical Gift Cards
- Custom Gift Cards
- Multi-brand Cards

## 33.2 Subscriptions
- Magazine Subscriptions
- Streaming Service Cards (Netflix / Prime / Hotstar)
- Music Service Cards (Spotify / YouTube Music)
- Cloud Storage Cards

## 33.3 Experience Vouchers
- Spa Vouchers
- Restaurant Vouchers
- Travel Vouchers

---

# 34. Software & Digital Goods

## 34.1 Operating Systems
- Windows Licenses
- macOS

## 34.2 Productivity
- Microsoft Office
- Google Workspace
- Adobe Creative Cloud

## 34.3 Antivirus & Security
- Antivirus
- VPN Services
- Password Managers

## 34.4 Online Courses
- Programming Courses
- Design Courses
- Business Courses
- Language Courses

## 34.5 Digital Books & Audio
- E-books
- Audio Books

---

# 35. Antiques & Collectibles

## 35.1 Antiques
- Antique Furniture
- Antique Decor
- Antique Lamps & Lighting
- Antique Watches
- Antique Books

## 35.2 Coin & Currency Collecting
- Indian Coins
- Foreign Coins
- Old Currency Notes
- Commemorative Coins

## 35.3 Stamp Collecting
- Indian Stamps
- Foreign Stamps
- Stamp Albums

## 35.4 Sports Memorabilia
- Cricket Memorabilia
- Football Memorabilia
- Signed Items

## 35.5 Movie Memorabilia
- Bollywood Memorabilia
- Hollywood Memorabilia
- Posters & Lobby Cards

---

# 36. Adult Products (18+)

## 36.1 Adult Wellness
- Lubricants
- Massagers
- Adult Toys
- Couples' Games

*(Show only when seller has age-verified compliance flag enabled.)*

---

# Summary

| Metric | Count |
|---|---|
| L1 Departments | **36** |
| L2 Sub-departments | ~250 |
| L3 Leaf categories | ~600 |
| Total nodes | ~890 |

## Indian-specific buckets included
- Sarees · Salwar Suits · Lehengas · Kurtas · Sherwanis · Mojaris
- Pooja items · Idols · Agarbatti · Diyas · Rudraksha · Yantras
- Ayurvedic products · Patanjali / Dabur / Himalaya products
- Diwali / Holi / Eid / Christmas / Rakhi decor
- Organic foods · Millets · Cold-pressed oils · Sattvik products
- Dry fruits · Mithai · Khakhras · Namkeen
- Cricket gear · Carrom · Indian comics · Regional language books
- Two-wheelers (huge in India)
- Indian wedding decor · Mandap · Bridal jewellery
- Tabla · Sitar · Harmonium · Bansuri (Indian musical instruments)

## What's intentionally excluded
- **Services** (cleaning, repair, on-demand) — out of scope for product marketplace
- **Real estate / property listings**
- **Travel & tourism bookings**
- **Tobacco** — listed but typically restricted; left out of seed
- **Liquor** — same; depends on state regulations and platform policy
- **Weapons / Firearms** — restricted, excluded
- **Live animals** — excluded (only pet supplies)
