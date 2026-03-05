const getIdx = (x, y, w) => (y * w + x) * 4;

export const applyMagicWand = (canvas, startX, startY, tolerance, mode, edgeSmoothing = 0) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const startIdx = getIdx(startX, startY, w);
  const targetR = data[startIdx], targetG = data[startIdx + 1], targetB = data[startIdx + 2], targetA = data[startIdx + 3];

  // FIX: If clicking on a completely transparent pixel, do nothing and return the unmodified image string.
  // (Previously this was returning `imageData` which broke the <img> tag)
  if (targetA === 0) return canvas.toDataURL('image/png');

  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
  let head = 0, tail = 0;

  const push = (x, y) => { qx[tail] = x; qy[tail] = y; tail++; mask[y * w + x] = 1; };

  const isMatch = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    if (mask[y * w + x] !== 0) return false;
    const idx = getIdx(x, y, w);
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

    if (mode === 'color') {
      if (a === 0) return false;
      return Math.abs(r - targetR) <= tolerance && Math.abs(g - targetG) <= tolerance && Math.abs(b - targetB) <= tolerance;
    } else {
      return a > 10; 
    }
  };

  if (isMatch(startX, startY)) push(startX, startY);

  while (head < tail) {
    const cx = qx[head], cy = qy[head]; head++;
    if (isMatch(cx + 1, cy)) push(cx + 1, cy);
    if (isMatch(cx - 1, cy)) push(cx - 1, cy);
    if (isMatch(cx, cy + 1)) push(cx, cy + 1);
    if (isMatch(cx, cy - 1)) push(cx, cy - 1);
  }

  const finalMask = new Uint8Array(w * h);
  finalMask.set(mask);

  if (edgeSmoothing > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x] === 1) {
          for (let dy = -edgeSmoothing; dy <= edgeSmoothing; dy++) {
            for (let dx = -edgeSmoothing; dx <= edgeSmoothing; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                finalMask[ny * w + nx] = 1;
              }
            }
          }
        }
      }
    }
  }

  for (let i = 0; i < w * h; i++) { if (finalMask[i] === 1) data[i * 4 + 3] = 0; }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

export const detectEmoteBoxes = (imageObj, tolerance = 15, mergeDist = 20) => {
  const canvas = document.createElement('canvas');
  const w = canvas.width = imageObj.width;
  const h = canvas.height = imageObj.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageObj, 0, 0);
  
  const data = ctx.getImageData(0, 0, w, h).data;
  const bgR = data[0], bgG = data[1], bgB = data[2];
  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h * 4), qy = new Int32Array(w * h * 4);
  let head = 0, tail = 0;

  const pushBg = (x, y) => { qx[tail] = x; qy[tail] = y; tail++; mask[y * w + x] = 1; };
  const isBgMatch = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h || mask[y * w + x] !== 0) return false;
    const idx = (y * w + x) * 4;
    if (data[idx + 3] < 10) return true;
    return Math.abs(data[idx] - bgR) <= tolerance && Math.abs(data[idx+1] - bgG) <= tolerance && Math.abs(data[idx+2] - bgB) <= tolerance;
  };

  [[0,0], [w-1,0], [0,h-1], [w-1,h-1]].forEach(([x,y]) => { if (isBgMatch(x,y)) pushBg(x,y); });

  while (head < tail) {
    const cx = qx[head], cy = qy[head]; head++;
    if (isBgMatch(cx + 1, cy)) pushBg(cx + 1, cy);
    if (isBgMatch(cx - 1, cy)) pushBg(cx - 1, cy);
    if (isBgMatch(cx, cy + 1)) pushBg(cx, cy + 1);
    if (isBgMatch(cx, cy - 1)) pushBg(cx, cy - 1);
  }

  let rawBoxes =[];
  const visited = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0 && data[idx * 4 + 3] > 10 && visited[idx] === 0) {
        let minX = x, maxX = x, minY = y, maxY = y;
        let oHead = 0, oTail = 0;
        qx[oTail] = x; qy[oTail] = y; oTail++;
        visited[idx] = 1;

        while (oHead < oTail) {
          const cx = qx[oHead], cy = qy[oHead]; oHead++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

          [[cx+1, cy], [cx-1, cy], [cx, cy+1],[cx, cy-1]].forEach(([nx, ny]) => {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nIdx = ny * w + nx;
              if (mask[nIdx] === 0 && data[nIdx*4+3] > 10 && visited[nIdx] === 0) {
                visited[nIdx] = 1; qx[oTail] = nx; qy[oTail] = ny; oTail++;
              }
            }
          });
        }
        if (maxX - minX > 15 && maxY - minY > 15) {
          rawBoxes.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
        }
      }
    }
  }

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rawBoxes.length; i++) {
      for (let j = i + 1; j < rawBoxes.length; j++) {
        const b1 = rawBoxes[i], b2 = rawBoxes[j];
        if (b1.x < b2.x + b2.w + mergeDist && b1.x + b1.w + mergeDist > b2.x &&
            b1.y < b2.y + b2.h + mergeDist && b1.y + b1.h + mergeDist > b2.y) {
          const nx = Math.min(b1.x, b2.x), ny = Math.min(b1.y, b2.y);
          const nw = Math.max(b1.x + b1.w, b2.x + b2.w) - nx;
          const nh = Math.max(b1.y + b1.h, b2.y + b2.h) - ny;
          rawBoxes[i] = { x: nx, y: ny, w: nw, h: nh };
          rawBoxes.splice(j, 1);
          merged = true; break;
        }
      }
      if (merged) break;
    }
  }
  return rawBoxes.map(b => ({ id: crypto.randomUUID(), ...b }));
};

export const removeBackgroundGlobal = (dataUrl, tolerance, edgeSmoothing = 0) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const dataUrlOut = applyMagicWand(canvas, 0, 0, tolerance, 'color', edgeSmoothing);
      
      const c2 = document.createElement('canvas'); c2.width = img.width; c2.height = img.height;
      const ctx2 = c2.getContext('2d');
      const img2 = new Image(); img2.onload = () => {
        ctx2.drawImage(img2, 0, 0);
        let out = applyMagicWand(c2, img.width-1, 0, tolerance, 'color', edgeSmoothing);
        out = applyMagicWand(c2, 0, img.height-1, tolerance, 'color', edgeSmoothing);
        out = applyMagicWand(c2, img.width-1, img.height-1, tolerance, 'color', edgeSmoothing);
        resolve(out);
      };
      img2.src = dataUrlOut;
    };
    img.src = dataUrl;
  });
};