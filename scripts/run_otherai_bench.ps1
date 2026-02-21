param(
  [int]$Games = 200,
  [string]$PolicyA = "otherai",
  [string]$PolicyB = "dad-slayer"
)

$repo = Split-Path -Parent $PSScriptRoot

$js = @"
const path=require('path');
const cwd=process.env.GOFISH_REPO;
const games=Number(process.env.GOFISH_GAMES||200);
const policyA=String(process.env.GOFISH_POLICY_A||'otherai');
const policyB=String(process.env.GOFISH_POLICY_B||'dad-slayer');
const Engine=require(path.join(cwd,'engine.js'));
let externalPolicy=null;
try{
  const mod=require(path.join(cwd,'policies','otherai.js'));
  externalPolicy=typeof mod==='function'?mod:(mod&&mod.pickMove);
}catch{}

function resolvePolicy(name){
  if(name==='otherai' && typeof externalPolicy==='function') return externalPolicy;
  return name;
}

function runBatch(games, policyA, policyB){
  const resolvedA=resolvePolicy(policyA);
  const resolvedB=resolvePolicy(policyB);
  const stats={games,policyA,policyB,p1:0,p2:0,tie:0,avgTurns:0};
  let turnsTotal=0;
  for(let i=0;i<games;i++){
    let s=Engine.initGame({seed:Date.now()+i});
    let turns=0;
    while(s.phase==='play' && turns<10000){
      const current=s.currentPlayer;
      const policy=current===0?resolvedA:resolvedB;
      const move=Engine.pickMove(s,policy,current);
      if(!move) break;
      s=Engine.applyAction(s,move).state;
      turns++;
    }
    Engine.finalizeWinner(s);
    turnsTotal+=turns;
    if(s.winner==='Tie') stats.tie++;
    else if(s.winner===s.players[0].name) stats.p1++;
    else stats.p2++;
  }
  stats.avgTurns=Number((turnsTotal/Math.max(games,1)).toFixed(2));
  return stats;
}

console.log(JSON.stringify({ok:true,stats:runBatch(games,policyA,policyB)}));
"@

$env:GOFISH_REPO = $repo
$env:GOFISH_GAMES = "$Games"
$env:GOFISH_POLICY_A = $PolicyA
$env:GOFISH_POLICY_B = $PolicyB
$result = node -e $js
if ($LASTEXITCODE -ne 0) {
  Write-Host "Benchmark failed: $result" -ForegroundColor Red
  exit 1
}

$obj = $result | ConvertFrom-Json
if (-not $obj.ok) {
  Write-Host "Benchmark failed: $result" -ForegroundColor Red
  exit 1
}

$stats = $obj.stats
$p1Rate = [math]::Round(($stats.p1 / [math]::Max($stats.games,1)) * 100, 2)
$p2Rate = [math]::Round(($stats.p2 / [math]::Max($stats.games,1)) * 100, 2)
$tieRate = [math]::Round(($stats.tie / [math]::Max($stats.games,1)) * 100, 2)

Write-Host ("Games={0} | {1}={2}% | {3}={4}% | tie={5}% | avgTurns={6}" -f $stats.games,$stats.policyA,$p1Rate,$stats.policyB,$p2Rate,$tieRate,$stats.avgTurns) -ForegroundColor Cyan
