// Pixel pong: a real framebuffer, computed one frame at a time by the
// TypeScript type checker.
//
// The screen is 64x48 bytes of palette indices. Like pong-tiny, the frame only
// pays for what moves: the court is drawn once, and each frame erases the
// previous ball and paddles before drawing the new ones. That keeps a steady
// frame at a few hundred byte-stores, which is one type evaluation.

#define W 64
#define H 48
#define BALL 3
#define PADDLE_W 4
#define PADDLE_H 10
#define PADDLE_X0 4
#define PADDLE_X1 (W - 4 - PADDLE_W)

// palette indices; the host turns these into colours
#define BG 0
#define COURT 1
#define BALL_C 2
#define P1_C 3
#define P2_C 4
#define SCORE_C 5

typedef struct state {
  int initialised;
  int ball_x, ball_y;
  int dir_x, dir_y;
  int p1_y, p2_y;
  int prev_ball_x, prev_ball_y;
  int prev_p1_y, prev_p2_y;
  int score1, score2;
  unsigned char court[H];
  unsigned char screen[W * H];
} state;

static state s = {
  .initialised = 0,
  .ball_x = W / 2,
  .ball_y = H / 2,
  .dir_x = 1,
  .dir_y = 1,
  .p1_y = (H - PADDLE_H) / 2,
  .p2_y = (H - PADDLE_H) / 2,
  .prev_ball_x = W / 2,
  .prev_ball_y = H / 2,
  .prev_p1_y = (H - PADDLE_H) / 2,
  .prev_p2_y = (H - PADDLE_H) / 2,
  .score1 = 0,
  .score2 = 0,
};

// A whole word costs one store, the same as a single byte: the memory the type
// checker keeps is a trie of 32-bit words, and writing one byte of a word means
// reading it, splicing, and writing it back. So anything four pixels wide and
// four-aligned is written as a word - the paddles are shaped for it.
static void fill_words(int x0, int y0, int w, int h, unsigned char colour) {
  unsigned int packed = (unsigned int) colour;
  packed |= packed << 8;
  packed |= packed << 16;
  for (int y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= H) continue;
    for (int x = x0; x < x0 + w; x += 4) {
      *(unsigned int *) &s.screen[y * W + x] = packed;
    }
  }
}

// A paddle is ten rows of one word. Unrolled, because the loop is not free:
// a row inside a loop costs the store plus a compare, an increment and a jump,
// and every one of those is an instantiation. Unrolled, the row offsets are
// constants that fold into the store instruction, so a paddle costs ten
// instructions instead of forty. Measured over a frame: 278 units of work down
// to 154.
#define ROW(n) row[(n) * (W / 4)] = packed
static void draw_paddle(int x, int y0, unsigned char colour) {
  unsigned int packed = (unsigned int) colour;
  packed |= packed << 8;
  packed |= packed << 16;
  if (y0 < 0) y0 = 0;
  if (y0 + PADDLE_H > H) y0 = H - PADDLE_H;
  unsigned int *row = (unsigned int *) &s.screen[y0 * W + x];
  ROW(0); ROW(1); ROW(2); ROW(3); ROW(4);
  ROW(5); ROW(6); ROW(7); ROW(8); ROW(9);
}
#undef ROW

// The ball is three rows of three bytes, and it moves one pixel at a time, so
// its address is not word-aligned. Same idea: constant offsets from one base.
static void draw_ball(int x, int y, unsigned char colour) {
  unsigned char *p = &s.screen[y * W + x];
  p[0] = colour; p[1] = colour; p[2] = colour;
  p[W] = colour; p[W + 1] = colour; p[W + 2] = colour;
  p[2 * W] = colour; p[2 * W + 1] = colour; p[2 * W + 2] = colour;
}

static void fill(int x0, int y0, int w, int h, unsigned char colour) {
  for (int y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= H) continue;
    for (int x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= W) continue;
      s.screen[y * W + x] = colour;
    }
  }
}

// A dashed centre line. The division is done once, at startup, into a table;
// after that a row of court costs one load instead of a divide, and only the
// rows the ball just erased are repainted rather than all 48.
static void build_court(void) {
  for (int y = 0; y < H; y++) s.court[y] = ((y / 3) % 2 == 0) ? COURT : BG;
}

static void draw_court(void) {
  for (int y = 0; y < H; y++) s.screen[y * W + W / 2] = s.court[y];
}

static void repair_court(int y0, int height) {
  for (int y = y0; y < y0 + height; y++) {
    if (y < 0 || y >= H) continue;
    s.screen[y * W + W / 2] = s.court[y];
  }
}

// three pixels per point, along the top edge
static void draw_scores(void) {
  fill(W / 2 - 14, 2, 12, 2, BG);
  fill(W / 2 + 3, 2, 12, 2, BG);
  for (int i = 0; i < s.score1 && i < 4; i++) fill(W / 2 - 5 - i * 3, 2, 2, 2, SCORE_C);
  for (int i = 0; i < s.score2 && i < 4; i++) fill(W / 2 + 4 + i * 3, 2, 2, 2, SCORE_C);
}

static void update(int button) {
  s.prev_ball_x = s.ball_x;
  s.prev_ball_y = s.ball_y;
  s.prev_p1_y = s.p1_y;
  s.prev_p2_y = s.p2_y;

  if (button == 1 && s.p1_y > 0) s.p1_y -= 2;
  if (button == 2 && s.p1_y + PADDLE_H < H) s.p1_y += 2;

  // the right paddle tracks the ball
  if (s.p2_y + PADDLE_H / 2 < s.ball_y && s.p2_y + PADDLE_H < H) s.p2_y += 1;
  if (s.p2_y + PADDLE_H / 2 > s.ball_y && s.p2_y > 0) s.p2_y -= 1;

  int nx = s.ball_x + s.dir_x;
  int ny = s.ball_y + s.dir_y;

  if (ny < 0) { ny = 0; s.dir_y = 1; }
  if (ny + BALL > H) { ny = H - BALL; s.dir_y = -1; }

  if (nx <= PADDLE_X0 + PADDLE_W && ny + BALL > s.p1_y && ny < s.p1_y + PADDLE_H) {
    nx = PADDLE_X0 + PADDLE_W;
    s.dir_x = 1;
  }
  if (nx + BALL >= PADDLE_X1 && ny + BALL > s.p2_y && ny < s.p2_y + PADDLE_H) {
    nx = PADDLE_X1 - BALL;
    s.dir_x = -1;
  }

  int scored = 0;
  if (nx < 0) { s.score2 += 1; scored = 1; }
  if (nx + BALL > W) { s.score1 += 1; scored = 1; }
  if (scored) {
    nx = W / 2;
    ny = H / 2;
    s.dir_x = -s.dir_x;
  }

  s.ball_x = nx;
  s.ball_y = ny;
}

__attribute__((export_name("frame")))
unsigned char *frame(int button) {
  if (!s.initialised) {
    s.initialised = 1;
    fill_words(0, 0, W, H, BG);
    build_court();
    draw_court();
    draw_scores();
    draw_paddle(PADDLE_X0, s.p1_y, P1_C);
    draw_paddle(PADDLE_X1, s.p2_y, P2_C);
    draw_ball(s.ball_x, s.ball_y, BALL_C);
    return s.screen;
  }

  int before1 = s.score1;
  int before2 = s.score2;
  update(button);

  draw_ball(s.prev_ball_x, s.prev_ball_y, BG);
  if (s.prev_p1_y != s.p1_y) draw_paddle(PADDLE_X0, s.prev_p1_y, BG);
  if (s.prev_p2_y != s.p2_y) draw_paddle(PADDLE_X1, s.prev_p2_y, BG);

  // the ball wipes the centre line as it crosses, so put back just those rows
  repair_court(s.prev_ball_y, BALL);
  if (s.score1 != before1 || s.score2 != before2) draw_scores();

  draw_paddle(PADDLE_X0, s.p1_y, P1_C);
  draw_paddle(PADDLE_X1, s.p2_y, P2_C);
  draw_ball(s.ball_x, s.ball_y, BALL_C);

  return s.screen;
}

__attribute__((export_name("score1")))
int get_score1(void) { return s.score1; }

__attribute__((export_name("score2")))
int get_score2(void) { return s.score2; }
