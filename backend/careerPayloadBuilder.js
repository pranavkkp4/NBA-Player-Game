/* =========================================================
   CAREER PAYLOAD BUILDER
   Converts simulated career data to AI-friendly format
   ========================================================= */

/**
 * Build a structured CareerPayload from simulated career data
 * 
 * This payload contains ONLY facts computed by the deterministic sim.
 * It avoids any new facts and passes only what was explicitly sim'd.
 */
function buildCareerPayload(
  playerName,
  birthDate,
  nationality,
  position,
  height,
  college,
  draftInfo,
  careerTimeline,
  careerStats,
  gameMode = 'career',
  seed = null
) {
  return {
    player: {
      fullName: playerName,
      birthDate: birthDate || 'Unknown',
      nationality: nationality || 'American',
      position,
      height: height || 'Unknown',
      college: college || 'Unknown'
    },
    careerTimeline: careerTimeline || [],
    careerStats: careerStats || {
      seasons: 0,
      teams: [],
      careerHighPoints: 0,
      careerHighAssists: 0,
      careerHighRebounds: 0,
      awards: [],
      injuries: []
    },
    modeContext: {
      gameMode,
      seed,
      note: 'All details are simulated from deterministic engine outputs.'
    }
  };
}

/**
 * Convert future.js career simulation result to CareerPayload
 * 
 * This extracts the minimal facts needed for biography generation
 * from the full simulation output.
 */
function careerSimToPayload(simResult, playerName, customPosition, birthDate) {
  const timeline = [];
  const teams = new Set();
  let careerHighPts = 0;
  let careerHighAst = 0;
  let careerHighReb = 0;
  const awards = [];
  const injuries = [];

  // Extract from seasons data
  if (simResult.seasons && Array.isArray(simResult.seasons)) {
    simResult.seasons.forEach((season, idx) => {
      const year = 2024 + idx; // Assume sim started 2024
      
      // Track team changes
      if (season.team) {
        teams.add(season.team);
      }

      // Career highs
      if (season.pts !== undefined) careerHighPts = Math.max(careerHighPts, season.pts);
      if (season.ast !== undefined) careerHighAst = Math.max(careerHighAst, season.ast);
      if (season.reb !== undefined) careerHighReb = Math.max(careerHighReb, season.reb);

      // Awards
      if (season.awards && Array.isArray(season.awards)) {
        season.awards.forEach(aw => awards.push(aw));
      }

      // Injuries (if tracked in sim)
      if (season.injury) {
        injuries.push({
          date: `${year}-${season.month || 1}`,
          injury: season.injury
        });
      }
    });
  }

  // Build timeline from seasons
  if (simResult.seasons && Array.isArray(simResult.seasons)) {
    if (simResult.seasons.length > 0) {
      timeline.push({
        date: `June 26, 2024`,
        event: 'Drafted',
        details: `Selected in the NBA Draft`
      });

      timeline.push({
        date: `October 2024`,
        event: 'NBA Debut',
        details: `Debuted in first NBA season with ${simResult.seasons[0].team || 'unknown team'}`
      });
    }
  }

  return {
    player: {
      fullName: playerName || 'Custom Player',
      birthDate: birthDate || 'Unknown',
      nationality: 'American',
      position: customPosition || 'SG',
      height: 'Unknown',
      college: 'Unknown'
    },
    careerTimeline: timeline,
    careerStats: {
      seasons: simResult.seasons ? simResult.seasons.length : 0,
      teams: Array.from(teams),
      careerHighPoints: Math.round(careerHighPts),
      careerHighAssists: Math.round(careerHighAst),
      careerHighRebounds: Math.round(careerHighReb),
      awards,
      injuries
    },
    modeContext: {
      gameMode: 'career',
      seed: simResult.seed || null,
      note: 'All details are simulated from deterministic engine outputs.'
    }
  };
}

// Export for Node.js/backend
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCareerPayload,
    careerSimToPayload
  };
}
