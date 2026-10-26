import { test, expect } from '@playwright/test';
// Les routes simulées doivent intercepter les API ; le SW réel est testé en HTTPS séparément.
test.use({serviceWorkers:'block'});
// APIs simulées : navigation réelle, aucun accès aux environnements et aucune base métier.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=', 'base64');
function pdf(): Buffer {
  const stream='BT /F1 12 Tf 20 100 Td (Justificatif test) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(content));content+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(content);content+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}
for (const format of ['png','pdf']) {
test(`ERP → PWA → société → import ${format}/IA → note → consultation ERP et rechargement`, async ({ page }) => {
  const original=format==='png'?png:pdf();const mime=format==='png'?'image/png':'application/pdf';const name='ticket.'+format;
  let societe=2; let note: any=null;
  const profile=()=>({utilisateurId:3,tenantId:1,societeCouranteId:societe,email:'test@example.test',nom:'Test',prenom:'Utilisateur',societeCouranteNom:'Société test',societesAutorisees:[{id:2,nom:'Société A'},{id:4,nom:'Société B'}],roles:['NOTE_DE_FRAIS'],permissions:[]});
  await page.route('**/api/**',async route=>{
    const req=route.request();const p=new URL(req.url()).pathname;
    if(p==='/api/auth/session/societe'){societe=req.postDataJSON().societeInterneId;return route.fulfill({json:profile()});}
    if(p==='/api/auth/session'||p==='/api/profil')return route.fulfill({json:profile()});
    if(p==='/api/tiers/me')return route.fulfill({json:{tiersId:42,roles:['SALARIE'],nom:'Test',prenom:'Utilisateur'}});
    if(p.includes('/reconnaissance'))return route.fulfill({json:{reconnu:false}});
    if(p.endsWith('/extraction-ia'))return route.fulfill({json:{donnees:{libelle:'Ticket navigateur',dateFacture:'2026-10-15',fournisseurNom:'Marchand test',totalHt:12,totalTva:0,totalTtc:12,lignes:[]},erreurs:[],erreursBloquantes:[]}});
    if(p==='/api/notes-frais'&&req.method()==='POST'){
      expect(req.headers()['content-type']).toContain('multipart/form-data');expect(req.postDataBuffer()!.includes(original)).toBeTruthy();
      note={id:12,tenantId:1,societeInterneId:societe,utilisateurCreateurId:3,libelle:'Ticket navigateur',dateDepense:'2026-10-15',anneeDepense:2026,moisDepense:10,montantHt:12,montantTva:0,montantTtc:12,devise:'EUR',statutNoteFrais:'BROUILLON',modePaiement:'CARTE_PERSONNELLE',lignes:[],pieceCheminStockage:'ndf:opaque-fixture',pieceNomOriginal:name};
      return route.fulfill({json:note});
    }
    if(p==='/api/notes-frais')return route.fulfill({json:note?[note]:[]});
    if(p==='/api/notes-frais/12')return route.fulfill({json:note});
    if(p.endsWith('/justificatif/contenu'))return route.fulfill({body:original,contentType:mime,headers:{'Cache-Control':'no-store'}});
    if(p.endsWith('/justificatif'))return route.fulfill({json:{documentId:'opaque-fixture',nom:name,typeMime:mime,tailleOctets:original.length,hashSha256:'a'.repeat(64)}});
    if(p.endsWith('/synthese-mensuelle')||p==='/api/contrats')return route.fulfill({json:[]});
    return route.fulfill({status:503,json:{message:'Fixture non disponible'}});
  });
  await page.goto('/dashboard');
  await page.locator('nav').getByRole('button',{name:'Mobile PWA',exact:true}).click();
  await expect(page).toHaveURL(/module=pwa/);
  await expect(page.locator('iframe[title="Module Wavy"]')).toHaveAttribute('src','/pwa/notes-frais');
  await expect(page.frameLocator('iframe[title="Module Wavy"]').locator('h1')).toBeVisible();
  await page.goto('/pwa/profil');await page.getByLabel('Société courante').selectOption({ label: 'Société B' });await expect(page).toHaveURL(/\/pwa\/notes-frais$/);expect(societe).toBe(4);
  await page.goto('/pwa/notes-frais/nouveau');
  await page.locator(format==='png'?'input[capture]':'input[type=file]:not([capture])').setInputFiles({name,mimeType:mime,buffer:original});
  await page.getByRole('button',{name:'Analyser par IA'}).click();await expect(page.locator('input[name=libelle]')).toHaveValue('Ticket navigateur');
  await page.getByRole('button',{name:'Créer note de frais',exact:true}).click();await expect(page).toHaveURL(/\/pwa\/notes-frais$/);
  expect(note.societeInterneId).toBe(4);
  await page.goto('/pwa/notes-frais/12');await page.getByRole('button',{name:'Afficher l’aperçu'}).click();await expect(page.locator(format==='png'?'img[alt=Justificatif]':'iframe[title="Aperçu du justificatif PDF"]')).toBeVisible();
  await page.reload();await expect(page.getByText(name, {exact:false}).first()).toBeVisible();
  await page.goto('/module?module=factures&path=%2Fnotes-frais%2F12&label=Notes%20de%20frais');
  const frame=page.frameLocator('iframe[title="Module Wavy"]');await frame.getByRole('button',{name:'Afficher l’aperçu'}).click();await expect(frame.locator(format==='png'?'img[alt=Justificatif]':'iframe[title="Aperçu du justificatif PDF"]')).toBeVisible();
  const download=page.waitForEvent('download');await frame.getByRole('button',{name:'Télécharger l’original'}).click();expect((await download).suggestedFilename()).toBe(name);
});
}
test('URL directe mobile sous /pwa et session expirée',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{message:'Session expirée'}}));
  await page.goto('/pwa/notes-frais/12');await expect(page).toHaveURL(/\/pwa\/connexion/);
  await expect(page.getByRole('heading',{name:/connexion|connecter/i})).toBeVisible();
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href','manifest.webmanifest');
  const manifest=await page.request.get('/pwa/manifest.webmanifest');expect((await manifest.json()).scope).toBe('/pwa/');
});

test('une ancienne session ne rétablit pas la société précédente lors du retour au premier plan', async ({page}) => {
  // Le test pilote les retours au premier plan ; les événements natifs du navigateur
  // ne doivent pas ajouter une lecture de session entre ses deux rendez-vous.
  await page.addInitScript(() => {
    for (const type of ['focus', 'pageshow']) {
      window.addEventListener(type, event => {
        if (event.isTrusted) event.stopImmediatePropagation();
      }, { capture: true });
    }
  });
  let company=2; let hold=false;
  const pending: import('@playwright/test').Route[]=[];
  const profile=(id:number)=>({utilisateurId:3,tenantId:1,societeCouranteId:id,email:'test@example.test',nom:'Test',societesAutorisees:[{id:2,nom:'A'},{id:4,nom:'B'}],roles:['NOTE_DE_FRAIS']});
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/auth/session') {
      if(hold){pending.push(route);return;}
      return route.fulfill({json:profile(company)});
    }
    return route.fulfill({json:[]});
  });
  await page.goto('/pwa/notes-frais');
  await expect(page.locator('main h1')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wavy-pwa-contexte')!).societeCouranteId)).toBe(2);
  hold=true;
  await page.getByRole('link',{name:'Profil',exact:true}).last().click();
  await expect.poll(()=>pending.length).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>pending.length).toBe(2);
  company=4; hold=false;
  await pending[1].fulfill({json:profile(company)});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wavy-pwa-contexte')!).societeCouranteId)).toBe(4);
  // Le navigateur a annulé cette requête ; la réponse tardive ne doit pas être appliquée.
  await pending[0].fulfill({json:profile(2)}).catch(()=>{});
  await expect(page).toHaveURL(/\/pwa\/profil$/);
  await expect(page.getByLabel('Société courante').locator('option:checked')).toHaveText('B');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wavy-pwa-contexte')!).societeCouranteId)).toBe(4);
});
