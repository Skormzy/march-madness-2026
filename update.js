#!/usr/bin/env node
/**
 * March Madness 2026 — Auto-Update Script
 *
 * This script is like a sports reporter who works on autopilot:
 *   1. Checks ESPN for new scores (the "wire service")
 *   2. Opens data.json (the "filing cabinet") to see what's already known
 *   3. Calculates updated standings and win probabilities
 *   4. Generates a fresh index.html (the "newspaper front page")
 *   5. Saves everything back
 *
 * Run: node update.js
 * No dependencies needed — uses only Node.js built-in modules.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONSTANTS
// ============================================================

// Points awarded per round (like prize money going up each round)
// R1 and R2 = 2 pts, Sweet 16 = 4, Elite 8 = 8, Final Four = 16, Championship = 32
function getPointsForGame(gameIdx) {
  if (gameIdx < 32) return 1;   // Round 1 (1 pt each — this pool's scoring)
  if (gameIdx < 48) return 2;   // Round 2
  if (gameIdx < 56) return 4;   // Sweet 16
  if (gameIdx < 60) return 8;   // Elite 8
  if (gameIdx < 62) return 16;  // Final Four
  return 32;                    // Championship
}

function getRoundName(gameIdx) {
  if (gameIdx < 32) return 'R1';
  if (gameIdx < 48) return 'R2';
  if (gameIdx < 56) return 'S16';
  if (gameIdx < 60) return 'E8';
  if (gameIdx < 62) return 'FF';
  return 'Championship';
}

// ESPN API endpoint — returns structured JSON (much easier than scraping HTML)
// Think of this as a direct phone line to the press box
const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

// Maps ESPN team names to our internal team IDs
// Like a translator between ESPN's language and our filing system
const ESPN_NAME_MAP = {
  // ESPN uses various name formats — we map them all
  "Duke": 70, "Duke Blue Devils": 70,
  "TCU": 262, "TCU Horned Frogs": 262,
  "St. John's": 252, "St John's": 252, "Saint John's": 252, "St. John's Red Storm": 252,
  "Kansas": 125, "Kansas Jayhawks": 125,
  "Louisville": 140, "Louisville Cardinals": 140,
  "Michigan State": 160, "Michigan St": 160, "Michigan St.": 160, "Mich. St.": 160,
  "UCLA": 287, "UCLA Bruins": 287,
  "UConn": 55, "Connecticut": 55, "UConn Huskies": 55,
  "Florida": 83, "Florida Gators": 83,
  "Iowa": 119, "Iowa Hawkeyes": 119,
  "Vanderbilt": 297, "Vandy": 297, "Vanderbilt Commodores": 297,
  "Nebraska": 180, "Nebraska Cornhuskers": 180,
  "VCU": 295, "VCU Rams": 295,
  "Illinois": 112, "Illinois Fighting Illini": 112,
  "Texas A&M": 270, "Tex. A&M": 270, "Texas A&M Aggies": 270,
  "Houston": 108, "Houston Cougars": 108,
  "Arizona": 10, "Arizona Wildcats": 10,
  "Utah State": 293, "Utah St": 293, "Utah St.": 293, "Utah State Aggies": 293,
  "High Point": 105, "High Point Panthers": 105,
  "Arkansas": 13, "Arkansas Razorbacks": 13,
  "Texas": 269, "Texas Longhorns": 269,
  "Gonzaga": 99, "Gonzaga Bulldogs": 99,
  "Miami": 157, "Miami Hurricanes": 157, "Miami (FL)": 157,
  "Purdue": 216, "Purdue Boilermakers": 216,
  "Michigan": 159, "Michigan Wolverines": 159,
  "St. Louis": 254, "Saint Louis": 254, "Saint Louis Billikens": 254,
  "Texas Tech": 274, "Texas Tech Red Raiders": 274,
  "Alabama": 3, "Alabama Crimson Tide": 3,
  "Tennessee": 265, "Tennessee Volunteers": 265,
  "Virginia": 300, "Virginia Cavaliers": 300,
  "Kentucky": 128, "Kentucky Wildcats": 128,
  "Iowa State": 120, "Iowa St": 120, "Iowa St.": 120, "Iowa State Cyclones": 120,
  "Ohio State": 200, "Ohio St": 200,
  "Clemson": 47,
  "Wisconsin": 318,
  "BYU": 34, "Brigham Young": 34,
  "Missouri": 166,
  "Georgia": 95,
  "North Carolina": 189, "UNC": 189,
  "Villanova": 299,
  "Siena": 238,
  "Northern Iowa": 194, "N. Iowa": 194,
  "CA Baptist": 369, "Cal Baptist": 369,
  "South Florida": 244, "USF": 244,
  "North Dakota State": 328, "N. Dakota St.": 328, "North Dakota St": 328,
  "Central Florida": 41, "UCF": 41,
  "Furman": 90,
  "Prairie View": 213, "Prairie View A&M": 213,
  "McNeese": 152, "McNeese State": 152,
  "Troy": 278,
  "Penn": 208, "Pennsylvania": 208,
  "St. Mary's": 255, "Saint Mary's": 255,
  "Idaho": 110,
  "Long Island": 373, "LIU": 373,
  "Hawaii": 104, "Hawai'i": 104,
  "Kennesaw State": 364, "Kennesaw St": 364, "Kennesaw St.": 364,
  "Queens": 374, "Queens University": 374,
  "Howard": 109,
  "Akron": 2,
  "Hofstra": 106,
  "Miami (OH)": 158, "Miami OH": 158, "Miami Ohio": 158,
  "Wright State": 320, "Wright St": 320,
  "Santa Clara": 234,
  "Tennessee State": 266, "Tennessee St": 266, "Tenn. St.": 266
};

// ============================================================
// BRACKET STRUCTURE
// ============================================================

/**
 * Gets the two "parent" games that feed into a given game.
 *
 * Analogy: Think of the bracket as a family tree in reverse.
 * Each game has two "parent" games whose winners become the competitors.
 * R1 games have no parents (they're the roots).
 *
 * The bracket is a binary tree:
 *   R1 (32 games: 0-31) → R2 (16 games: 32-47) → S16 (8: 48-55)
 *   → E8 (4: 56-59) → FF (2: 60-61) → Championship (1: 62)
 */
function getParentGames(gameIdx) {
  // Round boundaries: [start, prevRoundStart]
  const rounds = [
    { start: 32, prevStart: 0 },   // R2 ← R1
    { start: 48, prevStart: 32 },  // S16 ← R2
    { start: 56, prevStart: 48 },  // E8 ← S16
    { start: 60, prevStart: 56 },  // FF ← E8
    { start: 62, prevStart: 60 },  // Champ ← FF
  ];

  for (const round of rounds) {
    if (gameIdx >= round.start && gameIdx < round.start + (round.start === 62 ? 1 : rounds.find(r => r.prevStart === round.start)?.start - round.start || 999)) {
      const offset = gameIdx - round.start;
      return [round.prevStart + offset * 2, round.prevStart + offset * 2 + 1];
    }
  }
  return null; // R1 games
}

// Simpler version of getParentGames
function getParents(g) {
  if (g < 32) return null;
  const roundStarts = [0, 32, 48, 56, 60, 62];
  for (let r = 1; r < roundStarts.length; r++) {
    const start = roundStarts[r];
    const prevStart = roundStarts[r - 1];
    const count = (r + 1 < roundStarts.length) ? roundStarts[r + 1] - start : 1;
    if (g >= start && g < start + count) {
      const offset = g - start;
      return [prevStart + offset * 2, prevStart + offset * 2 + 1];
    }
  }
  return null;
}

/**
 * Gets the two teams playing in a given game.
 * For R1, uses the hardcoded matchups from the bracket.
 * For later rounds, looks up who won the parent games.
 */
function getMatchupTeams(gameIdx, results, r1Games) {
  if (gameIdx < 32) return r1Games[gameIdx];
  const parents = getParents(gameIdx);
  if (!parents) return [null, null];
  const team1 = results[String(parents[0])];
  const team2 = results[String(parents[1])];
  return [team1, team2];
}

// ============================================================
// ESPN FETCHING
// ============================================================

/**
 * Fetches JSON from a URL using Node's built-in https module.
 * Like making a phone call and writing down what you hear.
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'MarchMadnessTracker/1.0' } }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Failed to parse ESPN response')); }
      });
    }).on('error', reject);
  });
}

/**
 * Checks ESPN for game results on a specific date.
 * Returns array of { team1Id, team2Id, winnerId, score, label }
 */
async function fetchESPNScores(dateStr) {
  // dateStr format: "20260322"
  const url = `${ESPN_API}?dates=${dateStr}&groups=100&limit=50`;
  console.log(`Fetching ESPN scores for ${dateStr}...`);

  try {
    const data = await fetchJSON(url);
    const completed = [];

    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const isComplete = comp.status?.type?.completed === true;
      if (!isComplete) continue;

      const competitors = comp.competitors || [];
      if (competitors.length !== 2) continue;

      // Map ESPN team names to our IDs
      const teams = competitors.map(c => {
        const name = c.team?.displayName || '';
        const short = c.team?.shortDisplayName || '';
        const abbr = c.team?.abbreviation || '';
        return ESPN_NAME_MAP[name] || ESPN_NAME_MAP[short] || ESPN_NAME_MAP[abbr] || null;
      });

      if (!teams[0] || !teams[1]) {
        console.log(`  Warning: Could not map teams: ${competitors.map(c => c.team?.displayName).join(' vs ')}`);
        continue;
      }

      const winner = competitors.find(c => c.winner);
      const winnerId = winner ?
        (ESPN_NAME_MAP[winner.team?.displayName] || ESPN_NAME_MAP[winner.team?.shortDisplayName]) : null;

      if (!winnerId) continue;

      const score = `${competitors[0].team?.shortDisplayName || ''} ${competitors[0].score}, ${competitors[1].team?.shortDisplayName || ''} ${competitors[1].score}`;

      completed.push({
        team1Id: teams[0],
        team2Id: teams[1],
        winnerId,
        score,
        label: `${winner.team?.shortDisplayName} W`
      });
    }

    console.log(`  Found ${completed.length} completed games`);
    return completed;
  } catch (err) {
    console.error(`  ESPN fetch error: ${err.message}`);
    return [];
  }
}

/**
 * Finds new game results that aren't yet in our data.
 * Like checking the wire service and filtering out stories you already published.
 */
function findNewResults(espnGames, data) {
  const newResults = [];

  // Check all games from R1 through Championship
  for (let g = 0; g < 63; g++) {
    if (data.results[String(g)] !== undefined) continue; // Already decided

    const [team1, team2] = getMatchupTeams(g, data.results, data.r1Games);
    if (!team1 || !team2) continue; // Parent games not decided yet

    // Look for this matchup in ESPN results
    for (const espnGame of espnGames) {
      const matchesForward = espnGame.team1Id === team1 && espnGame.team2Id === team2;
      const matchesReverse = espnGame.team1Id === team2 && espnGame.team2Id === team1;

      if (matchesForward || matchesReverse) {
        newResults.push({
          gameIndex: g,
          winnerId: espnGame.winnerId,
          score: espnGame.score,
          label: espnGame.label,
          round: getRoundName(g)
        });
        break;
      }
    }
  }

  return newResults;
}

// ============================================================
// STANDINGS CALCULATION
// ============================================================

/**
 * Calculates points, rankings, and max possible for each entry.
 *
 * Analogy: Like a teacher grading exams — go through each answer,
 * check against the answer key (game results), award points,
 * then rank everyone by total score.
 */
function calculateStandings(data) {
  const alive = getAliveTeams(data);

  return data.entries.map(entry => {
    let points = 0;
    let maxPossible = 0;

    for (let g = 0; g < 63; g++) {
      const pts = getPointsForGame(g);
      const result = data.results[String(g)];

      if (result !== undefined) {
        // Game is decided — check if entry picked correctly
        if (entry.picks[g] === result) points += pts;
      } else {
        // Game not decided — check if entry's pick is still alive
        if (alive.has(entry.picks[g])) maxPossible += pts;
      }
    }

    maxPossible += points; // Total max = current points + future possible

    return {
      name: entry.name,
      points,
      maxPossible,
      champion: data.teams[String(entry.picks[62])] || '?',
      championId: entry.picks[62],
      isYou: data.yourEntries.includes(entry.name)
    };
  })
  .sort((a, b) => b.points - a.points || b.maxPossible - a.maxPossible)
  .map((entry, i, arr) => {
    // Assign ranks (handle ties — same rank if same points)
    if (i === 0 || entry.points < arr[i - 1].points) {
      entry.rank = i + 1;
    } else {
      entry.rank = arr[i - 1].rank;
    }
    return entry;
  });
}

/**
 * Returns the set of teams still alive in the tournament.
 * A team is alive if it hasn't lost any game.
 */
function getAliveTeams(data) {
  // Start with all R1 winners
  const alive = new Set();
  for (let g = 0; g < 32; g++) {
    const winner = data.results[String(g)];
    if (winner) alive.add(winner);
  }

  // Remove losers from R2+ games
  for (let g = 32; g < 63; g++) {
    const result = data.results[String(g)];
    if (result === undefined) continue;
    const [team1, team2] = getMatchupTeams(g, data.results, data.r1Games);
    // The team that didn't win is eliminated
    if (team1 && team1 !== result) alive.delete(team1);
    if (team2 && team2 !== result) alive.delete(team2);
  }

  return alive;
}

// ============================================================
// MONTE CARLO SIMULATION
// ============================================================

/**
 * Estimates win probability for each entry by simulating the
 * remaining tournament thousands of times.
 *
 * Analogy: Imagine rolling dice 10,000 times to predict the weather.
 * Each "roll" simulates every remaining game with random outcomes
 * weighted by team strength (seed). After all simulations, the
 * percentage of times each entry won is their win probability.
 *
 * Higher seeds win more often, but upsets happen — just like real life.
 */
function runMonteCarlo(data, iterations = 10000) {
  const wins = {};
  data.entries.forEach(e => wins[e.name] = 0);

  for (let sim = 0; sim < iterations; sim++) {
    // Create a copy of results for this simulation
    const simResults = { ...data.results };

    // Simulate each undecided game in order
    for (let g = 0; g < 63; g++) {
      if (simResults[String(g)] !== undefined) continue;

      const [team1, team2] = getMatchupTeams(g, simResults, data.r1Games);
      if (!team1 || !team2) continue;

      // Use seed difference to weight the coin flip
      const seed1 = data.seeds[String(team1)] || 8;
      const seed2 = data.seeds[String(team2)] || 8;
      // Higher seed (lower number) has an advantage
      // P(team1 wins) increases as team2's seed increases relative to team1's
      const prob1 = 0.5 + (seed2 - seed1) * 0.03;
      const clampedProb = Math.max(0.15, Math.min(0.85, prob1));

      const winner = Math.random() < clampedProb ? team1 : team2;
      simResults[String(g)] = winner;
    }

    // Calculate points for each entry in this simulation
    let bestPoints = -1;
    let bestEntries = [];

    for (const entry of data.entries) {
      let pts = 0;
      for (let g = 0; g < 63; g++) {
        if (entry.picks[g] === simResults[String(g)]) {
          pts += getPointsForGame(g);
        }
      }
      if (pts > bestPoints) {
        bestPoints = pts;
        bestEntries = [entry.name];
      } else if (pts === bestPoints) {
        bestEntries.push(entry.name);
      }
    }

    // Split the win among tied entries
    for (const name of bestEntries) {
      wins[name] += 1 / bestEntries.length;
    }
  }

  // Convert to percentages
  const probs = {};
  for (const [name, w] of Object.entries(wins)) {
    probs[name] = Math.round((w / iterations) * 1000) / 10; // e.g., 3.2%
  }
  return probs;
}

// ============================================================
// TIMELINE UPDATE
// ============================================================

/**
 * Adds new data points to the probability timeline.
 * Like adding a new column to a spreadsheet each time scores change.
 */
function updateTimeline(data, newResults, probs) {
  const trackedEntries = Object.keys(data.timeline.data);

  for (const result of newResults) {
    const teamName = data.teams[String(result.winnerId)] || '?';
    data.timeline.labels.push(result.label || `${teamName} W`);

    for (const entryName of trackedEntries) {
      const prob = probs[entryName] || 0;
      data.timeline.data[entryName].push(prob);
    }
  }
}

// ============================================================
// HTML GENERATION
// ============================================================

/**
 * Generates the complete index.html dashboard.
 *
 * Analogy: This is like a newspaper layout editor — takes all the
 * facts (standings, probabilities, game results) and arranges them
 * into a beautiful front page with charts, tables, and commentary.
 */
function generateHTML(data, standings, probs) {
  const you = standings.find(s => s.name === 'Seymour #2') || standings[0];
  const leader = standings[0];
  const alive = getAliveTeams(data);
  const ptsBehind = leader.points - you.points;

  // Chart entries to show on the probability line graph
  const chartEntries = [
    { name: "Seymour #2", color: "#00e5cc", width: 4, dash: "[]" },
    { name: "Seymour", color: "rgba(0,229,204,0.4)", width: 2, dash: "[5,5]", hidden: true },
    { name: "Thomas9712w", color: "#22d3ee", width: 2, dash: "[]" },
    { name: "Suge Knight", color: "#ff6b6b", width: 2, dash: "[4,4]" },
    { name: "Billy O", color: "#ffd43b", width: 2, dash: "[]" },
    { name: "Slamdunk2026", color: "#a78bfa", width: 2, dash: "[]" },
    { name: "Scott Carrick", color: "#f97316", width: 1.5, dash: "[]" },
    { name: "Daniel", color: "#84cc16", width: 1.5, dash: "[]" },
    { name: "B Crew", color: "#ec4899", width: 1.5, dash: "[]" },
    { name: "Doaners_picks", color: "#64748b", width: 1.5, dash: "[4,4]" },
  ];

  // Build standings rows (top 20 + your entries)
  const standingsRows = standings.slice(0, 20).map(s => {
    const cls = s.isYou ? ' class="you"' : '';
    const tag = s.isYou ? ' <span class="tag tag-you">YOU</span>' : (s.rank === 1 ? ' <span class="tag tag-leader">LEADER</span>' : '');
    const probStyle = s.isYou ? ' style="color:#00e5cc;font-weight:bold;"' : (s.rank <= 3 ? ' style="color:#ffd43b;"' : '');
    return `  <tr${cls}><td>${s.rank}</td><td>${s.name}${tag}</td><td>${s.points}</td><td>${s.maxPossible}</td><td>${s.champion}</td><td${probStyle}>${probs[s.name] || 0}%</td></tr>`;
  }).join('\n');

  // Build game cards for R2
  const gameCards = [];
  for (let g = 32; g < 48; g++) {
    const [t1, t2] = getMatchupTeams(g, data.results, data.r1Games);
    if (!t1 || !t2) continue;
    const t1Name = data.teams[String(t1)] || '?';
    const t2Name = data.teams[String(t2)] || '?';
    const t1Seed = data.seeds[String(t1)] || '?';
    const t2Seed = data.seeds[String(t2)] || '?';
    const region = data.regions[String(t1)] || '?';
    const result = data.results[String(g)];
    const youPick = data.entries.find(e => e.name === 'Seymour #2')?.picks[g];
    const youPickName = data.teams[String(youPick)] || '?';

    if (result) {
      const winnerName = data.teams[String(result)] || '?';
      const youGotIt = youPick === result;
      const statusColor = youGotIt ? '#51cf66' : '#ff6b6b';
      const statusIcon = youGotIt ? 'WON' : 'LOST';
      gameCards.push(`
  <div class="game-card">
    <div class="game-teams">
      <strong>(${t1Seed}) ${t1Name} vs (${t2Seed}) ${t2Name}</strong> &mdash; ${region} &mdash; <span style="color:${statusColor};">FINAL: ${winnerName} wins</span>
      <div class="pick-compare">You picked: ${youPickName} ${youGotIt ? '+2' : 'X'}</div>
    </div>
    <div class="game-impact"><span class="${youGotIt ? 'root-for' : 'root-against'}">${statusIcon}</span></div>
  </div>`);
    } else {
      gameCards.push(`
  <div class="game-card">
    <div class="game-teams">
      <strong>(${t1Seed}) ${t1Name} vs (${t2Seed}) ${t2Name}</strong> &mdash; ${region} &mdash; <span style="color:#ffd43b;">UPCOMING</span>
      <div class="pick-compare">You picked: ${youPickName}</div>
    </div>
    <div class="game-impact"><span class="root-for">ROOT: ${youPickName.toUpperCase()}</span></div>
  </div>`);
    }
  }

  // Bracket path for Seymour #2
  const youEntry = data.entries.find(e => e.name === 'Seymour #2');

  // Probability chart data
  const maxProb = Math.max(...Object.values(probs));
  const chartMax = Math.ceil(maxProb + 1.5);

  const timelineJSON = JSON.stringify(data.timeline);
  const probsJSON = JSON.stringify(probs);

  // Build the complete HTML
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>White Owl March Madness 2026 - Seymour's Pool Tracker</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-annotation/3.0.1/chartjs-plugin-annotation.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0e14; color: #e0e0e0; padding: 20px; max-width: 1100px; margin: 0 auto; }
  h1 { color: #00e5cc; font-size: 28px; margin-bottom: 5px; }
  h2 { color: #00e5cc; font-size: 20px; margin: 30px 0 15px; border-bottom: 2px solid #1a2d3d; padding-bottom: 8px; }
  h3 { color: #7ec8e3; font-size: 16px; margin: 20px 0 10px; }
  .subtitle { color: #888; font-size: 14px; margin-bottom: 25px; }
  .update-badge { font-size: 12px; color: #888; font-weight: normal; background: #1a2d3d; padding: 3px 10px; border-radius: 12px; margin-left: 10px; }
  .card { background: #141b24; border-radius: 12px; padding: 20px; margin: 15px 0; border: 1px solid #1e2a36; }
  .hero { text-align: center; padding: 30px 20px; margin-bottom: 20px; background: linear-gradient(135deg, #0d1a26 0%, #142233 50%, #0d1a26 100%); border-radius: 16px; border: 1px solid #1e3a5f; }
  .hero-prob { font-size: 72px; font-weight: 800; color: #00e5cc; line-height: 1; margin: 10px 0; text-shadow: 0 0 40px rgba(0,229,204,0.3); }
  .hero-label { font-size: 16px; color: #7ec8e3; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
  .hero-sublabel { font-size: 14px; color: #888; margin-top: 8px; }
  .hero-stats { display: flex; justify-content: center; gap: 40px; margin-top: 25px; padding-top: 20px; border-top: 1px solid #1e3a5f; flex-wrap: wrap; }
  .hero-stat { text-align: center; }
  .hero-stat-val { font-size: 28px; font-weight: 700; color: #e0e0e0; }
  .hero-stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .hero-status { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-top: 15px; background: rgba(81,207,102,0.15); color: #51cf66; border: 1px solid rgba(81,207,102,0.3); }
  .chart-container { background: #141b24; border-radius: 12px; padding: 20px; margin: 15px 0; border: 1px solid #1e2a36; }
  .chart-wrapper { position: relative; height: 320px; }
  .bottom-line-card { background: linear-gradient(135deg, #0d2818 0%, #142233 100%); border: 1px solid #1a4a2a; border-radius: 12px; padding: 24px; margin: 15px 0; }
  .bl-item { display: flex; gap: 12px; align-items: flex-start; margin: 12px 0; }
  .bl-icon { font-size: 20px; width: 28px; text-align: center; flex-shrink: 0; }
  .bl-text { font-size: 15px; line-height: 1.5; }
  .standings-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .standings-table th { background: #0a0e14; color: #00e5cc; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .standings-table td { padding: 10px 12px; border-bottom: 1px solid #1e2a36; font-size: 14px; }
  .standings-table tr.you { background: rgba(0, 229, 204, 0.08); }
  .standings-table tr.you td { color: #00e5cc; font-weight: bold; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .tag-leader { background: rgba(255,215,0,0.15); color: #ffd700; }
  .tag-you { background: rgba(0,229,204,0.15); color: #00e5cc; }
  .game-card { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #1e2a36; }
  .game-card:last-child { border-bottom: none; }
  .game-teams { flex: 1; }
  .game-teams strong { font-size: 14px; }
  .pick-compare { font-size: 12px; color: #888; margin-top: 4px; }
  .game-impact { text-align: right; min-width: 90px; }
  .root-for { background: rgba(81,207,102,0.15); color: #51cf66; padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: bold; }
  .root-against { background: rgba(255,107,107,0.15); color: #ff6b6b; padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: bold; }
  .impact-neutral { background: rgba(136,136,136,0.15); color: #888; padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: bold; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
  @media (max-width: 700px) { .grid-2 { grid-template-columns: 1fr; } .hero-stats { gap: 20px; } }
</style>
</head>
<body>

<h1>White Owl March Madness 2026 <span class="update-badge">Last updated: ${data.lastUpdated}</span></h1>
<p class="subtitle">Seymour's Pool Tracker &bull; 40 Entries &bull; Auto-updated via GitHub Actions</p>

<!-- HERO -->
<div class="hero">
  <div class="hero-label">Your Win Probability</div>
  <div class="hero-prob">${probs['Seymour #2'] || 0}%</div>
  <div class="hero-sublabel">Seymour #2 &bull; ${you.rank === 1 ? '1st' : (you.rank <= 3 ? you.rank + 'th' : 'T-' + you.rank + 'th')} place &bull; ${ptsBehind === 0 ? 'LEADING' : ptsBehind + ' pts behind 1st'}</div>
  <div class="hero-status">BRACKET ALIVE &mdash; ${alive.has(159) ? 'MICHIGAN STILL IN' : 'MICHIGAN ELIMINATED'}</div>
  <div class="hero-stats">
    <div class="hero-stat"><div class="hero-stat-val">${you.points}</div><div class="hero-stat-label">Current Points</div></div>
    <div class="hero-stat"><div class="hero-stat-val">${you.maxPossible}</div><div class="hero-stat-label">Max Possible</div></div>
    <div class="hero-stat"><div class="hero-stat-val">${you.rank === 1 ? '1st' : 'T-' + you.rank + 'th'}</div><div class="hero-stat-label">Current Place</div></div>
    <div class="hero-stat"><div class="hero-stat-val">${you.maxPossible - you.points}</div><div class="hero-stat-label">Points Remaining</div></div>
  </div>
</div>

<!-- BOTTOM LINE -->
<div class="bottom-line-card">
  <h3 style="color:#51cf66; margin-top:0;">The Bottom Line</h3>
  <div class="bl-item"><div class="bl-icon">&#127942;</div>
    <div class="bl-text"><strong>${ptsBehind === 0 ? 'You are in the lead!' : ptsBehind <= 5 ? 'Still very much alive.' : 'Gap is growing, but not out of it.'}</strong> You're ${ptsBehind === 0 ? 'leading' : ptsBehind + ' pts behind ' + leader.name + ' (' + leader.points + ' pts)'}. Your ${probs['Seymour #2']}% win probability is ${(probs['Seymour #2'] || 0) >= 2.5 ? 'above' : 'below'} the 2.5% pool average. ${you.maxPossible - you.points} pts still in play.</div>
  </div>
  <div class="bl-item"><div class="bl-icon">&#127936;</div>
    <div class="bl-text"><strong>Your champion: Michigan (${alive.has(159) ? 'ALIVE' : 'ELIMINATED'}).</strong> ${alive.has(159) ? 'Michigan is still in the tournament. Every Michigan win adds to your point total and boosts your probability.' : 'Michigan has been eliminated. Your championship pick is dead, limiting your ceiling.'}</div>
  </div>
  <div class="bl-item"><div class="bl-icon">&#9888;&#65039;</div>
    <div class="bl-text"><strong>Biggest threat: ${leader.name}</strong> (${leader.rank === 1 ? '1st' : leader.rank + 'th'}, ${leader.points} pts, ${leader.champion} champ, ${leader.maxPossible} max).</div>
  </div>
</div>

<!-- PROBABILITY CHART -->
<div class="chart-container">
  <h3 style="margin-top:0; margin-bottom: 15px;">Win Probability Over Time</h3>
  <div class="chart-wrapper"><canvas id="probChart"></canvas></div>
</div>
<script>
const PROBS = ${probsJSON};
const probTimeline = ${timelineJSON};
const CHART_ENTRIES = ${JSON.stringify(chartEntries)};

const datasets = CHART_ENTRIES.map(e => ({
  label: e.name + (PROBS[e.name] !== undefined ? ' (' + PROBS[e.name] + '%)' : ''),
  data: probTimeline.data[e.name] || [2.5, PROBS[e.name] || 2.5],
  borderColor: e.color, backgroundColor: e.name === "Seymour #2" ? 'rgba(0,229,204,0.06)' : 'transparent',
  borderWidth: e.width, borderDash: JSON.parse(e.dash), fill: e.name === "Seymour #2",
  tension: 0.3, pointRadius: e.name === "Seymour #2" ? 5 : 3, pointBackgroundColor: e.color,
  hidden: e.hidden || false,
}));

new Chart(document.getElementById('probChart').getContext('2d'), {
  type: 'line', data: { labels: probTimeline.labels, datasets },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: '#888', font: { size: 11 }, boxWidth: 20, padding: 12, usePointStyle: true } },
      tooltip: { backgroundColor: 'rgba(20,27,36,0.95)', borderColor: '#1e3a5f', borderWidth: 1, titleColor: '#00e5cc', bodyColor: '#e0e0e0', padding: 12,
        callbacks: { label: ctx => ctx.dataset.label.split(' (')[0] + ': ' + ctx.parsed.y + '%' } },
      annotation: { annotations: { avgLine: { type: 'line', yMin: 2.5, yMax: 2.5, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [6,4],
        label: { display: true, content: 'Pool avg (2.5%)', position: 'start', color: '#666', font: {size:10}, backgroundColor: 'transparent' } } } }
    },
    scales: {
      x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(30,42,54,0.5)' } },
      y: { min: 0, max: ${chartMax}, ticks: { color: '#888', font: { size: 11 }, callback: v => v + '%', stepSize: 1 }, grid: { color: 'rgba(30,42,54,0.5)' } }
    }
  }
});
<\/script>

<!-- STANDINGS -->
<h2>Current Standings</h2>
<div class="card">
<table class="standings-table">
  <tr><th>#</th><th>Entry</th><th>Pts</th><th>Max</th><th>Champion</th><th>Win %</th></tr>
${standingsRows}
</table>
<p style="font-size:12px; color:#666; margin-top:10px;">Win% estimated via Monte Carlo simulation (10K runs). ${data.yourEntries[1]} is ${standings.find(s => s.name === data.yourEntries[1])?.rank || '?'}th (${probs[data.yourEntries[1]] || 0}%).</p>
</div>

<!-- GAMES -->
<h2>Round 2 Games</h2>
<div class="card">
${gameCards.join('\n')}
</div>

<!-- BRACKET PATH -->
<h2>Your Full Bracket Path (Seymour #2)</h2>
<div class="grid-2">
  <div class="card">
    <h3 style="margin-top:0;">East: ${data.teams[String(youEntry.picks[56])] || '?'} to Win</h3>
    <p style="font-size:13px;">S16: ${data.teams[String(youEntry.picks[48])]} over ${data.teams[String(youEntry.picks[49])]}<br>
    E8: <strong>${data.teams[String(youEntry.picks[56])]}</strong></p>
  </div>
  <div class="card">
    <h3 style="margin-top:0;">South: ${data.teams[String(youEntry.picks[57])] || '?'} to Win</h3>
    <p style="font-size:13px;">S16: ${data.teams[String(youEntry.picks[50])]} over ${data.teams[String(youEntry.picks[51])]}<br>
    E8: <strong>${data.teams[String(youEntry.picks[57])]}</strong></p>
  </div>
  <div class="card">
    <h3 style="margin-top:0;">West: ${data.teams[String(youEntry.picks[58])] || '?'} to Win</h3>
    <p style="font-size:13px;">S16: ${data.teams[String(youEntry.picks[52])]} over ${data.teams[String(youEntry.picks[53])]}<br>
    E8: <strong>${data.teams[String(youEntry.picks[58])]}</strong></p>
  </div>
  <div class="card">
    <h3 style="margin-top:0;">Midwest: ${data.teams[String(youEntry.picks[59])] || '?'} to Win</h3>
    <p style="font-size:13px;">S16: ${data.teams[String(youEntry.picks[54])]} over ${data.teams[String(youEntry.picks[55])]}<br>
    E8: <strong>${data.teams[String(youEntry.picks[59])]}</strong></p>
  </div>
</div>
<div class="card" style="border-left: 4px solid #00e5cc;">
  <h3 style="margin-top:0;">Final Four &amp; Championship</h3>
  <p><strong>Semi 1:</strong> ${data.teams[String(youEntry.picks[60])]} &bull; <strong>Semi 2:</strong> ${data.teams[String(youEntry.picks[61])]} &bull; <strong>Champion:</strong> <span style="color:#00e5cc;">${data.teams[String(youEntry.picks[62])]}</span></p>
</div>

<p style="text-align:center; color:#444; margin-top:40px; font-size:12px;">Auto-updated by GitHub Actions &bull; Data from ESPN API &bull; Analysis by Claude</p>
</body>
</html>`;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const dataPath = path.join(__dirname, 'data.json');
  const htmlPath = path.join(__dirname, 'index.html');

  // 1. Read the filing cabinet
  console.log('Reading data.json...');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // 2. Check the wire service (ESPN) for today's and yesterday's scores
  const now = new Date();
  const today = now.toISOString().slice(0, 10).replace(/-/g, '');
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10).replace(/-/g, '');

  const todayScores = await fetchESPNScores(today);
  const yesterdayScores = await fetchESPNScores(yesterday);
  const allScores = [...yesterdayScores, ...todayScores];

  // 3. Find new results we haven't recorded yet
  const newResults = findNewResults(allScores, data);

  if (newResults.length === 0) {
    console.log('No new games found. Dashboard is up to date.');
        data.lastUpdated = now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    // Still regenerate HTML in case this is the first run
    const standings = calculateStandings(data);
    const probs = runMonteCarlo(data);
    const html = generateHTML(data, standings, probs);
    fs.writeFileSync(htmlPath, html);
    console.log('HTML regenerated.');
    return;
  }

  console.log(`Found ${newResults.length} new result(s):`);
  newResults.forEach(r => {
    console.log(`  Game ${r.gameIndex} (${r.round}): ${data.teams[String(r.winnerId)]} wins — ${r.score}`);
  });

  // 4. Record the new results
  for (const r of newResults) {
    data.results[String(r.gameIndex)] = r.winnerId;
  }

  // 5. Recalculate standings
  const standings = calculateStandings(data);

  // 6. Run Monte Carlo simulation for win probabilities
  console.log('Running Monte Carlo simulation (10,000 iterations)...');
  const probs = runMonteCarlo(data);

  // 7. Update the probability timeline
  updateTimeline(data, newResults, probs);

  // 8. Update timestamp
  data.lastUpdated = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short'
  });

  // 9. Save updated data
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log('data.json updated.');

  // 10. Generate and save HTML
  const html = generateHTML(data, standings, probs);
  fs.writeFileSync(htmlPath, html);
  console.log('index.html generated.');

  // 11. Summary
  const you = standings.find(s => s.name === 'Seymour #2');
  console.log(`\nSeymour #2: ${you.rank}th place, ${you.points} pts, ${probs['Seymour #2']}% win probability`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
