import { expect, test } from "@playwright/test";
import { measureContrast } from "../a11y.js";

// A medição de contraste só vale se ela consegue reprovar: este teste injeta casos conhecidos e confere o veredito.
// Cores: #cad5e2 sobre branco = 1,49:1; #777777 sobre branco = 4,48:1 (abaixo de 4,5 e acima de 3).
test("a medição de contraste reprova o que deve e aprova o que deve", async ({ page }) => {
  await page.setContent(`
    <body style="background:#fff;font-size:16px">
      <p style="color:#cad5e2">claro</p>
      <p style="color:#0f172a">escuro</p>
      <p style="color:#0f172a;opacity:0.3">esmaecido</p>
      <p style="color:#777777">quase</p>
      <p style="color:#777777;font-size:24px">quase grande</p>
      <input value="x" style="color:#cad5e2;border:1px solid #0f172a">
      <p style="color:#cad5e2" aria-hidden="true">aria-hidden não isenta</p>
      <button disabled style="color:#cad5e2">desabilitado</button>
    </body>`);
  const failed = (await measureContrast(page)).map((failure) => failure.text).sort();
  expect(failed).toEqual(["aria-hidden não isenta", "claro", "esmaecido", "quase", "texto digitado em <input>"].sort());
});

test("fundo com gradiente faz a medição falhar em voz alta em vez de calcular contra o fundo errado", async ({ page }) => {
  await page.setContent(`<body><div style="background:linear-gradient(#000,#fff)"><p style="color:#777">sobre gradiente</p></div></body>`);
  await expect(measureContrast(page)).rejects.toThrow(/imagem ou gradiente/);
});
