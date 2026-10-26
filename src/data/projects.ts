export type Project = {
  name: string;
  blurb: string;
  award?: string;
  date: string;
  stack: string[];
  links: { label: string; href: string }[];
};

export const projects: Project[] = [
  {
    name: 'LabTwin',
    award: 'Winner · Gemini 4 Argon Hackathon',
    date: 'Oct 2026',
    blurb:
      'Debugs biolab protocols by building a MuJoCo digital twin of your bench from a photo, finding the failing step, and proving the fix in simulation.',
    stack: ['Gemini 4 Argon', 'MuJoCo', 'Gymnasium', 'Python'],
    links: [{ label: 'github', href: 'https://github.com/benjaminxie1/argon-hacks' }],
  },
  {
    name: 'Recourse',
    award: '1st · a16z SpeedHacks',
    date: 'Oct 2026',
    blurb:
      'AI agent for refunds and insurance claims: extracts facts from evidence, drafts the request, and makes user-approved calls and browser actions.',
    stack: ['Next.js', 'TypeScript', 'SQLite', 'Playwright'],
    links: [{ label: 'github', href: 'https://github.com/Will-code112223/Speedhacks' }],
  },
  {
    name: 'GridTwin',
    award: 'Recursive Agents Hackathon',
    date: 'Oct 2026',
    blurb:
      'Agents for power-plant operations that won’t say “done” until an independent verifier proves it.',
    stack: ['NVIDIA Nemotron', 'Crusoe Inference', 'Python'],
    links: [{ label: 'github', href: 'https://github.com/benjaminxie1/recursiveagents' }],
  },
  {
    name: 'Sentinel',
    award: '1st · Congressional App Challenge',
    date: '2024',
    blurb:
      'YOLO wildfire-detection camera network piloted in the Santa Monica Mountains; presented at the U.S. Capitol.',
    stack: ['Python', 'YOLO', 'OpenCV', 'React'],
    links: [
      { label: 'github', href: 'https://github.com/benjaminxie1/sentinel-app' },
      { label: 'archive', href: '/files/congressional-app-challenge-2024.pdf' },
    ],
  },
];
