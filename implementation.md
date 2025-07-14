# Implementation Log

## 2025-01-03 - Updated Polynomial Regression Paper Description

### Changes Made:
1. **Updated paper description** - Changed the description text for the polynomial regression paper:
   - From: "Propose polynomial regression as a simple task to better understand in-context learning, in particular fine-tuning and alignment behavior."
   - To: "Univariate polynomial regression is a simple task which captures in-context fine-tuning and alignment behavior, facilitating visualization and deeper understanding."

### Location:
- File: `index.html`
- Lines modified: Description paragraph for the polynomial regression paper

## 2025-01-03 - Updated Paper Links and Added Coauthor Links

### Changes Made:
1. **Changed main link for SUPE paper** - Changed the paper title link from project page to arXiv:
   - From: `https://wilcoxsonm21.github.io/supe/`
   - To: `https://arxiv.org/abs/2410.18076`

2. **Added coauthor links for both papers**:
   
   **Paper 1 (SUPE paper):**
   - Qiyang Li → https://colinqiyangli.github.io/
   - Kevin Frans → https://kvfrans.com/
   - Sergey Levine → https://people.eecs.berkeley.edu/~svlevine/
   
   **Paper 2 (Polynomial regression paper):**
   - Morten Svendgård → https://www.linkedin.com/in/morten-svendgård-327971152/?originalSubdomain=no
   - Ria Doshi → https://riadoshi.github.io/
   - Dylan Davis → https://www.linkedin.com/in/dylanjdavi
   - Reya Vir → https://reyavir.wixsite.com/home
   - Anant Sahai → https://www2.eecs.berkeley.edu/Faculty/Homepages/sahai.html

### Location:
- File: `index.html`
- Lines modified: Both paper entries in the publications section

## 2025-01-03 - Fixed BibTeX Functionality

### Changes Made:
1. **Created /data directory** - Added a new directory to store bibtex files
2. **Created .bib files** - Created individual bibtex files for each paper:
   - `data/wilcoxson2025leveraging.bib` - For the SUPE paper
   - `data/wilcoxson2024polynomialregression.bib` - For the polynomial regression paper
3. **Updated HTML links** - Replaced JavaScript onclick handlers with direct links to .bib files:
   - Changed `javascript:void(0)" onclick="copyBibtex1()"` to `data/wilcoxson2025leveraging.bib`
   - Changed `javascript:void(0)" onclick="copyBibtex2()"` to `data/wilcoxson2024polynomialregression.bib`
4. **Removed JavaScript functions** - Removed the copyBibtex1() and copyBibtex2() functions

### Files Created:
- `/data/wilcoxson2025leveraging.bib`
- `/data/wilcoxson2024polynomialregression.bib`

### Location:
- File: `index.html`
- Lines modified: Both paper entries in the publications section

## 2025-01-03 - Updated Profile and Research Information

### Changes Made:
1. **Profile Section Update** - In `index.html`, replaced the Google DeepMind paragraph with new academic information:
   - Changed from "research scientist at Google DeepMind" to "incoming PhD student at CSAIL"
   - Added advisor information: "advised by Russ Tedrake"
   - Updated education: "did by B.A. at Berkeley where I was advised by Sergey Levine"
   - Removed Google work history and PAMI Young Researcher Award
   - **Added links**: Linked "Russ Tedrake" to https://locomotion.csail.mit.edu/russt.html and "Sergey Levine" to https://people.eecs.berkeley.edu/~svlevine/
   - **Added award information**: Added sentence about receiving the Warren Y. Dere Design Award during undergrad, linked to https://www2.eecs.berkeley.edu/Students/Awards/4/

2. **Research Interests Update** - Updated the research section paragraph:
   - Changed from "computer vision, deep learning, generative AI, and image processing" focus
   - Updated to "reinforcement learning, generative models, sample-efficient exploration, robotics, and computer vision"
   - Removed specific mentions of "inferring the physical world" and "radiance fields"
   - Kept the "Some papers are highlighted" text

### Location:
- File: `index.html`
- Lines modified: Profile paragraph (~lines 27-32) and Research paragraph (~lines 45-50)

## 2025-01-03 - Website Restructuring

### Changes Made:
1. **Created `/supe` directory** - Created a new subdirectory to house the SUPE research paper website
2. **Moved SUPE research content** - Moved the original `index.html` (containing the full SUPE research paper website) to `supe/index.html`
3. **Created new root landing page** - Created a new simple `index.html` at the root with:
   - Clean, modern design with gradient background
   - Personal welcome message: "Hi, this is Max Wilcoxson's personal website"
   - Navigation links to SUPE research, GitHub, and Google Scholar
   - Responsive design for mobile devices

### File Structure After Changes:
```
/
├── index.html (new simple landing page)
├── supe/
│   └── index.html (moved SUPE research paper website)
├── static/ (unchanged)
├── implementation.md (this file)
└── README.md (unchanged)
```

### Website Navigation:
- Root (`/`) - Personal landing page
- `/supe` - SUPE research paper website

## 2025-01-03 - Fixed SUPE Website Asset Paths

### Issue:
After moving the SUPE research paper website to `/supe/index.html`, all CSS, JavaScript, and image assets were broken because the relative paths were incorrect.

### Changes Made:
1. **CSS Files** - Updated all CSS links from `./static/css/` to `../static/css/`:
   - `bulma.min.css`
   - `bulma-carousel.min.css`
   - `bulma-slider.min.css`
   - `fontawesome.all.min.css`
   - `index.css`

2. **JavaScript Files** - Updated all JS links from `./static/js/` to `../static/js/`:
   - `fontawesome.all.min.js`
   - `bulma-carousel.min.js`
   - `bulma-slider.min.js`
   - `index.js`

3. **Images and Videos** - Updated all media paths from `static/images/` to `../static/images/`:
   - Video files: `explore_anim.mp4`, `traj_skills_anim.mp4`, `supe_anim.mp4`
   - Method graphics: `supe_method_graphic.png`, `temp_uncorrelated_website.png`, `skill-figure-website.png`, `pessimistic_reward_website.png`
   - Animation frames: All 5 optimistic exploration images
   - Results charts: `supe-results-agg.png`, `antmaze-goal-time-new3.png`

### Result:
The SUPE research paper website at `/supe` now displays correctly with all styling, animations, and images working properly.

## 2025-01-27: Updated Website Template for SUPE Paper

### Changes Made:
- **Title and Meta Tags**: Updated page title from "Nerfies: Deformable Neural Radiance Fields" to "SUPE: Leveraging Skills from Unlabeled Prior Data for Efficient Online Exploration"
- **Meta Description**: Changed to describe SUPE's reinforcement learning approach
- **Keywords**: Updated to reflect RL, exploration, skills, and prior data concepts

### Author Information:
- **Authors**: Updated to Max Wilcoxson, Qiyang Li, Kevin Frans, Sergey Levine
- **Affiliation**: Changed from University of Washington/Google Research to UC Berkeley
- **Links**: Updated author profile links (placeholder URLs for some authors)

### Paper Links:
- **PDF Link**: Updated to arXiv:2410.18076 PDF
- **arXiv Link**: Updated to correct arXiv page
- **Code Link**: Updated to point to SUPE GitHub repository (placeholder URL)
- **Removed**: Video and dataset links that were specific to Nerfies

### Content Updates:
- **Abstract**: Completely rewritten to describe SUPE's approach to exploration in RL using prior data
- **Teaser Section**: Removed video, added text description of SUPE's capabilities
- **Video Carousel**: Completely removed as it was Nerfies-specific
- **Paper Video Section**: Removed YouTube video embed
- **Method Overview Section**: Added description of SUPE's three-stage approach
- **Results Section**: Added key findings about performance improvements
- **Related Work**: Updated to cover relevant RL and exploration literature
- **BibTeX**: Updated citation information for the SUPE paper

### Footer Updates:
- **PDF Link**: Updated to point to arXiv PDF
- **GitHub Link**: Updated to SUPE repository
- **Source Code Reference**: Updated repository URL in footer text

### Removed Sections:
- Visual Effects (Dolly zoom demo)
- Matting section
- Animation/Interpolation sections
- All video-based demonstrations
- Concurrent work section (replaced with Related Work)

### Notes:
- Maintained the same overall visual structure and styling
- Kept the same CSS and JavaScript dependencies
- Preserved the responsive design and layout
- Some author profile URLs may need to be updated with actual links
- Code repository URL is placeholder and should be updated when available

## 2025-01-27: Comprehensive Update with Detailed Paper Content

### Major Enhancements:
- **Detailed Method Description**: Added comprehensive explanation of SUPE's three-phase approach
- **Problem Formulation**: Included mathematical notation and clear problem setup
- **Skill Extraction**: Detailed VAE-based approach with encoder q_φ(z|τ) and decoder π_θ(a|s,z)
- **Pseudo-labeling Strategy**: Explained reward labels (r̂) and high-level action labels (ẑ)
- **Experimental Section**: Added detailed results from 42 tasks across AntMaze and OGBench
- **Key Innovation Highlight**: Emphasized the dual use of offline data as SUPE's main contribution
- **Ablation Studies**: Listed comprehensive sensitivity analyses and robustness tests
- **Related Work**: Detailed coverage of skill discovery, exploration, hierarchical RL, and offline-to-online RL

### Content Based on arXiv Paper:
- Used exact abstract from arXiv:2410.18076v3
- Incorporated experimental details from the full paper
- Added proper mathematical notation for policies and reward models
- Referenced specific baseline comparisons mentioned in the paper
- Included robustness analysis from appendices

### Updated Links:
- **Code Repository**: Updated to https://github.com/rail-berkeley/supe (official repository)
- **Navigation**: Updated to UC Berkeley RAIL lab homepage
- **Author Links**: Maintained placeholder URLs for author profiles

### Visual Improvements:
- Added notification boxes for key results highlighting
- Used structured boxes for method phases
- Improved typography with proper subscripts for mathematical notation
- Enhanced content hierarchy with clear section divisions

## 2025-01-27: User-Requested Content Structure Update

### Author Updates:
- **Author URLs**: Updated Max Wilcoxson to wilcoxsonm21.github.io and Qiyang Li to colinqiyangli.github.io
- **Equal Contribution**: Added asterisks (*) to indicate Max Wilcoxson and Qiyang Li as equal contributors

### Content Restructuring:
- **Removed Hero Teaser Section**: Eliminated the large teaser section with key innovation box
- **Added Method Figure**: Added placeholder for supe_method_graphic.png image
- **Abstract Refinements**: Minor text improvements ("unlabeled prior trajectory data", "pseudo-relabels", condensed final paragraph)

### New Challenges and Method Section:
- **Challenges (Left Column)**: 
  - Unstructured Exploration: Problem of temporally incoherent exploration in sparse reward settings
  - No Access to Task-Specific Reward Labels: Issues with pessimistic offline reward estimation
- **Method (Right Column)**:
  - Skill Extraction: Detailed VAE-based approach for learning temporally coherent behaviors
  - Optimistic Relabelling: Two-step process using VAE encoder and RND-based uncertainty bonuses
  - Integration: Explanation of how components combine for hierarchical policy learning

### Enhanced Key Results Section:
- **Restructured Layout**: Moved to separate full-width section with 2x2 grid of notification boxes
- **Performance Highlights**: 42 tasks, AntMaze efficiency, OGBench success, robustness across data qualities
- **Visual Organization**: Better spacing and grouping of result categories

## 2025-01-27: Method Section Layout Restructure

### Major Layout Changes:
- **Single Method Section**: Replaced the previous two-column "Challenges" and "Method" layout with unified "Method" section
- **Full-Width Introduction**: Added introductory text: "Our method uses unlabelled prior data in two distinct ways to address two different exploration challenges."

### New Challenge-Solution Structure:
- **Row 1 - Light Magenta Background** (#f8e8f8, rounded corners, 2rem padding):
  - Left Column: Challenge #1: Unstructured Exploration (with temp_uncorrelated_website.png image)
  - Right Column: Solution #1: Skill Extraction (VAE-based approach description)
  
- **Row 2 - Light Red Background** (#ffe8e8, rounded corners, 2rem padding):
  - Left Column: Challenge #2: No Access to Task-Specific Reward Labels (with pessimistic_reward_website.png image)
  - Right Column: Solution #2: Optimistic Relabelling (reward estimation with RND uncertainty bonus)

### Content Organization:
- **Visual Flow**: Creates clear pairing between each challenge and its corresponding solution
- **Color Coordination**: Light magenta and light red backgrounds complement the existing images
- **Full-Width Conclusion**: Moved final integration paragraph to separate full-width section below the challenge-solution pairs
- **Improved Readability**: Better spacing and visual separation between concepts

### 2025-01-27: Visual Refinements

#### Color Adjustments:
- **Magenta Background**: Changed from #f8e8f8 to #f5e0f5 for a more pink appearance as requested

#### Layout Improvements:  
- **Method Diagram Width**: Constrained the supe_method_graphic.png image to use the same width container (is-max-desktop) as the background rectangles to prevent it from extending beyond them

### 2025-01-27: Optimistic Exploration Animation

#### New Animated Figure:
- **Location**: Added animated figure above "Solution #2: Optimistic Relabelling" text in the light red background section
- **Images**: Cycles through 5 images from `static/images/optimistic_exploration_images/` folder
- **Timing**: 0.5 seconds per frame as requested
- **Animation Logic**: Uses CSS opacity transitions and JavaScript setInterval to cycle frames

#### Technical Implementation:
- **CSS Styling**: Added opacity-based animation with instant frame switching (no fade transitions)
- **JavaScript**: DOM-ready event listener that cycles through frames every 500ms
- **HTML Structure**: Positioned images absolutely within relative container for seamless transitions
- **Frame Management**: Uses modulo operator to loop infinitely through the 5 image sequence

#### Animation Refinement:
- **Removed Cross Dissolve**: Eliminated CSS transition property to provide instant frame switching instead of fade effects
- **Width Adjustment**: Changed animation from full width to 50% width and centered it with `margin: 0 auto`

### 2025-01-27: Added Skill Figure to Solution #1

#### Image Addition:
- **Location**: Added skill-figure-website.png image above the text in "Solution #1: Skill Extraction" section
- **Placement**: Positioned directly after the section heading and before the paragraph text
- **Styling**: Applied full-width image styling with consistent margins matching other images in the document
- **Alt Text**: Added descriptive alt text "Skill Extraction Process" for accessibility

### 2025-01-27: Updated Optimistic Relabelling Text

#### Content Revision:
- **Section**: Revised "Solution #2: Optimistic Relabelling" paragraph text
- **Structure Change**: Consolidated multi-paragraph explanation with ordered list into single cohesive paragraph
- **Content Updates**: 
  - Changed "relabel offline data" to "label dataset rewards optimistically"
  - Simplified explanation to focus on reward estimation via reward model + RND uncertainty bonus
  - Added explanation of skill latent action estimation using VAE encoder
  - Maintained core message about optimistic reward estimates encouraging exploration
- **Formatting**: Fixed bold tag formatting to use consistent `<strong>` tags

### 2025-01-27: Results Section Overhaul

#### Major Section Restructure:
- **Title Change**: Updated from "Experimental Results" to "Results"
- **Content Replacement**: Completely replaced comprehensive evaluation, key findings, and ablation studies sections
- **New Central Figure**: Added `supe-results-agg.png` as the main results visualization

#### Content Updates:
- **Evaluation Scope**: Updated to describe evaluation across 8 domains with 42 sparse reward, long-horizon tasks
- **Baseline Descriptions**: Added detailed explanations of all baseline methods:
  - DBC + JSRL (simple baseline without optimistic labeling or skill pretraining)
  - ExPLORe (adds optimistic relabelling)
  - Trajectory Skills (skill pretraining with VAE method)
  - HILP Skills (skill pretraining with Hilbert space traversal)
  - SUPE variants (combining skill pretraining with optimistic relabelling)
- **Performance Analysis**: Included comparative performance analysis across different task difficulties
- **Key Insight**: Emphasized the importance of using offline data twice (skill pretraining + off-policy data)

#### Removed Sections:
- **Key Results**: Removed notification boxes with high-level performance highlights
- **Comprehensive Evaluation**: Removed detailed domain descriptions (AntMaze, OGBench)
- **Key Findings**: Removed exploration efficiency, sample efficiency, and robustness boxes
- **Ablation Studies**: Removed entire ablation studies subsection and bullet points

### 2025-01-27: Bold Method Names in Results

#### Text Formatting:
- **Method Names**: Added `<strong>` tags around all method names in the Results section for better readability
- **Methods Bolded**: DBC + JSRL, ExPLORe, Trajectory Skills, HILP Skills, SUPE, SUPE (HILP)
- **Consistency**: Applied bold formatting consistently throughout the Results paragraph text

### 2025-01-27: Environment Names Formatting

#### Text Formatting:
- **Environment Names**: Applied monospace font styling using `<code>` tags to environment names
- **Case Changes**: Made all environment names lowercase for consistency
- **Environments Formatted**: 
  - `scene` (appears multiple times)
  - `humanoidmaze` (appears multiple times)  
  - `antsoccer` (changed from "AntSoccer")
- **Style**: Monospace font matches the equidistance font style shown in the results image

### 2025-01-27: Results Section Structure Enhancement

#### Header and Subsections:
- **Centered Header**: Wrapped "Results" title in `has-text-centered` div for center alignment
- **Sample Efficiency Subsection**: Added "Sample Efficiency" as subtitle for existing content
- **Exploration Ablation Subsection**: Added new section with:
  - Subtitle "Exploration Ablation"
  - Image: `antmaze-goal-time-new3.png` (AntMaze Goal Reach Times)
  - Text explaining first goal reach times analysis in `antmaze` environment
  - Environment name formatting: Applied `<code>` tags to `antmaze` for consistency

#### Content Organization:
- **Two-Part Results**: Split results into Sample Efficiency (overall performance) and Exploration Ablation (goal reach analysis)
- **Visual Structure**: Maintained consistent image and text layout patterns across both subsections

### 2025-01-27: Results Title Spacing

#### Layout Adjustment:
- **Vertical Spacing**: Added `margin-bottom: 2rem`