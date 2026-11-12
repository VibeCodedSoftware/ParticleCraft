// FX Code: Godot-style uniform lines become settings; the body is checked as untrusted code before compiling.
import { describe, expect, it } from 'vitest';
import { FX_CODE_DEFAULT, fxValue, parseFxCode } from '../src/fxCode';

describe('FX code', () => {
  it('reads Godot-style uniforms into settings', () => {
    const r = parseFxCode(`uniform float uv_scale : hint_range(0.5, 8.0, 0.1) = 2.0;
uniform vec3 glow : source_color = vec3(1.0, 0.5, 0.0);
uniform bool flip = true;
uniform sampler2D noise_tex;
uniform int steps : hint_range(1, 8) = 4;
return color * glow;`);
    expect(r.errors).toEqual([]);
    expect(r.uniforms).toEqual([
      { name: 'uv_scale', type: 'float', def: 2, min: 0.5, max: 8, step: 0.1 },
      { name: 'glow', type: 'vec3', def: '#ff8000' },
      { name: 'flip', type: 'bool', def: true },
      { name: 'noise_tex', type: 'sampler2D', def: '' },
      { name: 'steps', type: 'float', def: 4, min: 1, max: 8, step: 1 },
    ]);
    expect(r.body).not.toMatch(/uniform/);
    expect(fxValue({ 'u:uv_scale': 3 }, r.uniforms[0])).toBe(3);
    expect(fxValue({}, r.uniforms[0])).toBe(2);
    expect(parseFxCode(FX_CODE_DEFAULT).errors).toEqual([]);
  });

  it('refuses anything outside one function body', () => {
    const bad = (code: string) => parseFxCode(code).errors.join(' ');
    expect(bad('#extension GL_OES_foo : enable\nreturn color;')).toMatch(/Preprocessor/);
    expect(bad('while (true) {}\nreturn color;')).toMatch(/while/);
    expect(bad('gl_FragColor = vec4(1.0);\nreturn color;')).toMatch(/gl_FragColor/);
    expect(bad('return color; }\nvoid evil() {')).toMatch(/braces/);
    expect(bad('return texture2D(tDiffuse, uv).rgb;')).toMatch(/screen\(uv\)/);
    expect(bad('return texture(tDiffuse, uv).rgb;')).toMatch(/declare it first/);
    expect(bad('uniform float uv = 1.0;\nreturn color;')).toMatch(/taken/);
    expect(bad('vec3 c = color;')).toMatch(/return/);
    expect(bad('x'.repeat(9000) + ' return color;')).toMatch(/too long/);
    // Comments may say anything.
    expect(parseFxCode('// while (true) #extension uniform\nreturn color;').errors).toEqual([]);
  });
});
