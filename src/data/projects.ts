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
    award: 'Winner, Gemini 4 Argon Hackathon (Cerebral Valley)',
    date: 'Oct 2026',
    blurb:
      'A physics-verified debugger for biolab protocols. Gemini reads a pipetting protocol and a photo of the bench, builds a MuJoCo digital twin, finds the exact step and well where the protocol fails, then rewrites it and proves the fix in simulation.',
    stack: ['Gemini 4 Argon', 'MuJoCo', 'Gymnasium', 'Python'],
    links: [{ label: 'github', href: 'https://github.com/benjaminxie1/argon-hacks' }],
  },
  {
    name: 'Recourse',
    award: '1st Place, a16z SpeedHacks',
    date: 'Oct 2026',
    blurb:
      'An AI assistant for refunds and insurance claims. It pulls facts out of uploaded evidence, drafts the request, and can place a support call or drive a browser task, with the user approving every action.',
    stack: ['Next.js', 'TypeScript', 'SQLite', 'Playwright'],
    links: [{ label: 'github', href: 'https://github.com/Will-code112223/Speedhacks' }],
  },
  {
    name: 'GridTwin',
    award: 'Recursive Agents Hackathon (Crusoe × Cerebral Valley)',
    date: 'Oct 2026',
    blurb:
      'A team of agents for power-plant operations that won’t say "done" until an independent verifier proves it. Give it a one-line goal on a simulated solar + battery plant and it ends verified, escalated, or with nothing to fix.',
    stack: ['NVIDIA Nemotron', 'Crusoe Inference', 'Python'],
    links: [{ label: 'github', href: 'https://github.com/benjaminxie1/recursiveagents' }],
  },
  {
    name: 'Sentinel',
    award: '1st Place, Congressional App Challenge',
    date: '2024',
    blurb:
      'A YOLO-based wildfire detection camera network, piloted at two sites in the Santa Monica Mountains. Swapping an R-CNN prototype for YOLO caught short-lived smoke plumes the slower model missed. Presented at the U.S. Capitol.',
    stack: ['Python', 'YOLO', 'OpenCV', 'React'],
    links: [
      { label: 'github', href: 'https://github.com/benjaminxie1/sentinel-app' },
      { label: 'archive', href: '/files/congressional-app-challenge-2024.pdf' },
    ],
  },
];
