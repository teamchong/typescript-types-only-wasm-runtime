// Tiny Pong, written to fit inside a type-level frame budget.
//
// The full-size pong in ../pong clears all 160x160 cells and then transposes
// them into a second buffer every frame: ~500,000 wasm operations, which is
// about 40 seconds per frame when the TypeScript type checker is the CPU.
//
// This version keeps the exact same game, but pays only for what moves:
//   * the screen is 40x24 and stored row-major, so there is no transpose
//   * the court line is drawn once, not every frame
//   * each frame erases the previous ball/paddle cells and draws the new ones
//
// That is a few hundred operations per frame instead of half a million.

#define W 40
#define H 24
#define BALL 2
#define PADDLE_H 4
#define PADDLE_X0 1
#define PADDLE_X1 (W - 2)

#define BLANK ' '
#define COURT '|'
#define BALL_CHAR '0'
#define PADDLE_CHAR '='

typedef struct state {
  int initialised;
  int ball_x, ball_y;
  int dir_x, dir_y;
  int p1_y, p2_y;
  int prev_ball_x, prev_ball_y;
  int prev_p1_y, prev_p2_y;
  int score1, score2;
  char screen[W * H];
} state;

static state s = {
  .initialised = 0,
  .ball_x = W / 2,
  .ball_y = H / 2,
  .dir_x = 1,
  .dir_y = 1,
  .p1_y = H / 2 - PADDLE_H / 2,
  .p2_y = H / 2 - PADDLE_H / 2,
  .prev_ball_x = W / 2,
  .prev_ball_y = H / 2,
  .prev_p1_y = H / 2 - PADDLE_H / 2,
  .prev_p2_y = H / 2 - PADDLE_H / 2,
  .score1 = 0,
  .score2 = 0,
};

static void put(int x, int y, char c) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  s.screen[y * W + x] = c;
}

// draw the static parts exactly once
static void init_screen(void) {
  for (int i = 0; i < W * H; i++) s.screen[i] = BLANK;
  for (int y = 0; y < H; y++) s.screen[y * W + (W / 2)] = COURT;
  s.initialised = 1;
}

static void erase_ball(int bx, int by) {
  for (int y = 0; y < BALL; y++)
    for (int x = 0; x < BALL; x++) {
      int px = bx + x;
      // keep the court line intact when the ball passes over it
      put(px, by + y, px == W / 2 ? COURT : BLANK);
    }
}

static void draw_ball(int bx, int by) {
  for (int y = 0; y < BALL; y++)
    for (int x = 0; x < BALL; x++) put(bx + x, by + y, BALL_CHAR);
}

static void erase_paddle(int px, int py) {
  for (int y = 0; y < PADDLE_H; y++) put(px, py + y, BLANK);
}

static void draw_paddle(int px, int py) {
  for (int y = 0; y < PADDLE_H; y++) put(px, py + y, PADDLE_CHAR);
}

// button: 0 = none, 1 = up, 2 = down (drives player 1; player 2 tracks the ball)
static void update(int button) {
  s.prev_ball_x = s.ball_x;
  s.prev_ball_y = s.ball_y;
  s.prev_p1_y = s.p1_y;
  s.prev_p2_y = s.p2_y;

  if (button == 1 && s.p1_y > 0) s.p1_y -= 1;
  if (button == 2 && s.p1_y + PADDLE_H < H) s.p1_y += 1;

  // player 2 follows the ball
  if (s.p2_y + PADDLE_H / 2 < s.ball_y && s.p2_y + PADDLE_H < H) s.p2_y += 1;
  if (s.p2_y + PADDLE_H / 2 > s.ball_y && s.p2_y > 0) s.p2_y -= 1;

  int nx = s.ball_x + s.dir_x;
  int ny = s.ball_y + s.dir_y;

  if (ny < 0) { ny = 0; s.dir_y = 1; }
  if (ny + BALL > H) { ny = H - BALL; s.dir_y = -1; }

  // paddle 1
  if (nx <= PADDLE_X0 + 1 && ny + BALL > s.p1_y && ny < s.p1_y + PADDLE_H) {
    nx = PADDLE_X0 + 2;
    s.dir_x = 1;
  }
  // paddle 2
  if (nx + BALL >= PADDLE_X1 && ny + BALL > s.p2_y && ny < s.p2_y + PADDLE_H) {
    nx = PADDLE_X1 - BALL;
    s.dir_x = -1;
  }

  // scoring: reset to the middle
  if (nx < 0) {
    s.score2 += 1;
    nx = W / 2; ny = H / 2; s.dir_x = 1;
  }
  if (nx + BALL > W) {
    s.score1 += 1;
    nx = W / 2; ny = H / 2; s.dir_x = -1;
  }

  s.ball_x = nx;
  s.ball_y = ny;
}

// Advance exactly one frame and return a pointer to the 40x24 screen.
__attribute__((export_name("frame")))
char *frame(int button) {
  if (!s.initialised) {
    init_screen();
    draw_paddle(PADDLE_X0, s.p1_y);
    draw_paddle(PADDLE_X1, s.p2_y);
    draw_ball(s.ball_x, s.ball_y);
    return s.screen;
  }

  update(button);

  erase_ball(s.prev_ball_x, s.prev_ball_y);
  if (s.prev_p1_y != s.p1_y) erase_paddle(PADDLE_X0, s.prev_p1_y);
  if (s.prev_p2_y != s.p2_y) erase_paddle(PADDLE_X1, s.prev_p2_y);

  draw_paddle(PADDLE_X0, s.p1_y);
  draw_paddle(PADDLE_X1, s.p2_y);
  draw_ball(s.ball_x, s.ball_y);

  return s.screen;
}

// expose the score so a driver can show it without decoding the screen
__attribute__((export_name("score1")))
int get_score1(void) { return s.score1; }

__attribute__((export_name("score2")))
int get_score2(void) { return s.score2; }
