#define _CRT_SECURE_NO_WARNINGS
#include <stdio.h>
#include <stdlib.h>

/*
 * 10장 배열 - Mini Project: TIC-TAC-TOE (도전문제 완성본)
 *
 *  (1) 이미 돌이 놓인 칸(또는 보드 밖)에 놓으려 하면 다시 입력받는다.
 *  (2) check_game_over() 함수로 매 수마다 보드를 분석해 승리/무승부를 판정한다.
 *  (3) 사람(X)이 한 수 두면 컴퓨터(O)가 "비어 있는 첫 번째 칸"에 자동으로 둔다.
 */

#define SIZE 3

void init_board(char board[SIZE][SIZE]);
void draw_board(char board[SIZE][SIZE]);
int  is_valid_move(char board[SIZE][SIZE], int x, int y);
void get_user_move(char board[SIZE][SIZE], int *x, int *y);
void get_computer_move(char board[SIZE][SIZE], int *x, int *y);
char check_game_over(char board[SIZE][SIZE]);

int main(void)
{
    char board[SIZE][SIZE];
    int x, y, k;
    char result = ' ';

    // 보드를 초기화한다.
    init_board(board);

    printf("TIC-TAC-TOE 게임 시작! (사용자: X, 컴퓨터: O)\n");
    draw_board(board);

    // 최대 9번 둘 수 있다. 짝수 번째는 사용자, 홀수 번째는 컴퓨터 차례.
    for (k = 0; k < 9; k++) {
        if (k % 2 == 0) {
            get_user_move(board, &x, &y);            // 도전문제 (1)
            board[x][y] = 'X';
        }
        else {
            get_computer_move(board, &x, &y);        // 도전문제 (3)
            board[x][y] = 'O';
            printf("컴퓨터가 (%d, %d)에 놓았습니다.\n", x, y);
        }

        // 보드를 화면에 그린다.
        draw_board(board);

        // 게임이 끝났는지 검사한다.                 // 도전문제 (2)
        result = check_game_over(board);
        if (result != ' ')
            break;
    }

    if (result == 'X')
        printf("사용자(X)가 이겼습니다!\n");
    else if (result == 'O')
        printf("컴퓨터(O)가 이겼습니다!\n");
    else
        printf("무승부입니다!\n");

    return 0;
}

// 보드의 모든 칸을 공백으로 초기화한다.
void init_board(char board[SIZE][SIZE])
{
    int x, y;
    for (x = 0; x < SIZE; x++)
        for (y = 0; y < SIZE; y++)
            board[x][y] = ' ';
}

// 보드를 화면에 그린다.
void draw_board(char board[SIZE][SIZE])
{
    int i;
    for (i = 0; i < SIZE; i++) {
        printf("---|---|---\n");
        printf(" %c | %c | %c \n", board[i][0], board[i][1], board[i][2]);
    }
    printf("---|---|---\n");
}

// 도전문제 (1): 좌표가 보드 안에 있고 빈 칸이면 1, 아니면 0을 반환한다.
int is_valid_move(char board[SIZE][SIZE], int x, int y)
{
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE)
        return 0;
    if (board[x][y] != ' ')
        return 0;
    return 1;
}

// 도전문제 (1): 올바른 좌표가 입력될 때까지 반복해서 입력받는다.
void get_user_move(char board[SIZE][SIZE], int *x, int *y)
{
    while (1) {
        printf("(x, y) 좌표: ");
        if (scanf(" %d %d", x, y) != 2) {
            int c;
            while ((c = getchar()) != '\n' && c != EOF)   // 잘못된 입력 버리기
                ;
            if (c == EOF) {                               // 입력이 끝나면 종료
                printf("\n입력이 종료되어 게임을 끝냅니다.\n");
                exit(0);
            }
            printf("숫자 두 개를 입력하세요.\n");
            continue;
        }
        if (is_valid_move(board, *x, *y))
            return;                                       // 올바른 좌표

        if (*x < 0 || *x >= SIZE || *y < 0 || *y >= SIZE)
            printf("보드 범위(0~2)를 벗어났습니다. 다시 입력하세요.\n");
        else
            printf("이미 '%c'가 놓인 자리입니다. 다시 입력하세요.\n", board[*x][*y]);
    }
}

// 도전문제 (3): 가장 간단한 알고리즘 - 비어 있는 첫 번째 칸을 선택한다.
void get_computer_move(char board[SIZE][SIZE], int *x, int *y)
{
    int i, j;
    for (i = 0; i < SIZE; i++) {
        for (j = 0; j < SIZE; j++) {
            if (board[i][j] == ' ') {
                *x = i;
                *y = j;
                return;
            }
        }
    }
}

// 도전문제 (2): 보드를 분석하여 게임 종료 여부를 반환한다.
//   'X' 또는 'O' : 해당 플레이어 승리
//   'D'          : 빈 칸이 없음(무승부)
//   ' '          : 게임 진행 중
char check_game_over(char board[SIZE][SIZE])
{
    int i, j;

    // 가로줄, 세로줄 검사
    for (i = 0; i < SIZE; i++) {
        if (board[i][0] != ' ' && board[i][0] == board[i][1] && board[i][1] == board[i][2])
            return board[i][0];
        if (board[0][i] != ' ' && board[0][i] == board[1][i] && board[1][i] == board[2][i])
            return board[0][i];
    }

    // 대각선 검사 (\ 방향, / 방향)
    if (board[0][0] != ' ' && board[0][0] == board[1][1] && board[1][1] == board[2][2])
        return board[0][0];
    if (board[0][2] != ' ' && board[0][2] == board[1][1] && board[1][1] == board[2][0])
        return board[0][2];

    // 빈 칸이 남아 있으면 계속 진행
    for (i = 0; i < SIZE; i++)
        for (j = 0; j < SIZE; j++)
            if (board[i][j] == ' ')
                return ' ';

    return 'D';   // 모든 칸이 찼고 승자가 없으면 무승부
}
