const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function updateGitHubStatus(owner, repo, sha, state, description, targetUrl) {
  if (!GITHUB_TOKEN) return;

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state, // 'pending', 'success', 'error', or 'failure'
        description,
        context: 'ci/magnus',
        target_url: targetUrl
      })
    });
    
    if (!response.ok) {
      console.error(`Failed to update GitHub status: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error updating GitHub status: ${error.message}`);
  }
}

module.exports = { updateGitHubStatus };
