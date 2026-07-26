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
#define PADDLE_W 2
#define PADDLE_H 10
#define PADDLE_X0 2
#define PADDLE_X1 (W - 2 - PADDLE_W)

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

static void fill(int x0, int y0, int w, int h, unsigned char colour) {
  for (int y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= H) continue;
    for (int x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= W) continue;
      s.screen[y * W + x] = colour;
    }
  }
}

// a dashed centre line, drawn once
static void draw_court(void) {
  for (int y = 0; y < H; y++) {
    if ((y / 3) % 2 == 0) s.screen[y * W + W / 2] = COURT;
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
    fill(0, 0, W, H, BG);
    draw_court();
    draw_scores();
    fill(PADDLE_X0, s.p1_y, PADDLE_W, PADDLE_H, P1_C);
    fill(PADDLE_X1, s.p2_y, PADDLE_W, PADDLE_H, P2_C);
    fill(s.ball_x, s.ball_y, BALL, BALL, BALL_C);
    return s.screen;
  }

  int before1 = s.score1;
  int before2 = s.score2;
  update(button);

  fill(s.prev_ball_x, s.prev_ball_y, BALL, BALL, BG);
  if (s.prev_p1_y != s.p1_y) fill(PADDLE_X0, s.prev_p1_y, PADDLE_W, PADDLE_H, BG);
  if (s.prev_p2_y != s.p2_y) fill(PADDLE_X1, s.prev_p2_y, PADDLE_W, PADDLE_H, BG);

  // the ball erases the court line as it crosses it, so repaint that column
  draw_court();
  if (s.score1 != before1 || s.score2 != before2) draw_scores();

  fill(PADDLE_X0, s.p1_y, PADDLE_W, PADDLE_H, P1_C);
  fill(PADDLE_X1, s.p2_y, PADDLE_W, PADDLE_H, P2_C);
  fill(s.ball_x, s.ball_y, BALL, BALL, BALL_C);

  return s.screen;
}

__attribute__((export_name("score1")))
int get_score1(void) { return s.score1; }

__attribute__((export_name("score2")))
int get_score2(void) { return s.score2; }
