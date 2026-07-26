(module
  (type $t0 (func (param i32) (result i32)))
  (type $t1 (func))
  (type $t2 (func (result i32)))
  (memory $env.memory (import "env" "memory") 1)
  (func $frame (export "frame") (type $t0) (param $p0 i32) (result i32)
    (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32) (local $l7 i32) (local $l8 i32) (local $l9 i32) (local $l10 i32) (local $l11 i32) (local $l12 i32) (local $l13 i32) (local $l14 i32)
    (block $B0
      (block $B1
        (br_if $B1
          (i32.load offset=8192
            (i32.const 0)))
        (i32.store offset=8192
          (i32.const 0)
          (i32.const 1))
        (local.set $l1
          (i32.const 8244))
        (local.set $l2
          (i32.const 0))
        (loop $L2
          (local.set $p0
            (i32.const 0))
          (loop $L3
            (i32.store8
              (i32.add
                (local.get $l1)
                (local.get $p0))
              (i32.const 0))
            (br_if $L3
              (i32.ne
                (local.tee $p0
                  (i32.add
                    (local.get $p0)
                    (i32.const 1)))
                (i32.const 64))))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L2
            (i32.ne
              (local.tee $l2
                (i32.add
                  (local.get $l2)
                  (i32.const 1)))
              (i32.const 48))))
        (local.set $p0
          (i32.const 0))
        (local.set $l1
          (i32.const 8276))
        (loop $L4
          (block $B5
            (br_if $B5
              (i32.and
                (i32.div_u
                  (i32.and
                    (local.get $p0)
                    (i32.const 255))
                  (i32.const 3))
                (i32.const 1)))
            (i32.store8
              (local.get $l1)
              (i32.const 1)))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L4
            (i32.ne
              (local.tee $p0
                (i32.add
                  (local.get $p0)
                  (i32.const 1)))
              (i32.const 48))))
        (call $f1)
        (local.set $l2
          (i32.add
            (select
              (local.tee $p0
                (i32.load offset=8212
                  (i32.const 0)))
              (local.tee $l1
                (i32.add
                  (local.get $p0)
                  (i32.const 9)))
              (i32.gt_s
                (local.get $p0)
                (local.get $l1)))
            (i32.const 1)))
        (local.set $l1
          (i32.add
            (i32.shl
              (local.get $p0)
              (i32.const 6))
            (i32.const 8247)))
        (loop $L6
          (block $B7
            (br_if $B7
              (i32.gt_u
                (local.get $p0)
                (i32.const 47)))
            (i32.store16
              (i32.add
                (local.get $l1)
                (i32.const -1))
              (i32.const 771)))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L6
            (i32.ne
              (local.get $l2)
              (local.tee $p0
                (i32.add
                  (local.get $p0)
                  (i32.const 1))))))
        (local.set $l2
          (i32.add
            (select
              (local.tee $p0
                (i32.load offset=8216
                  (i32.const 0)))
              (local.tee $l1
                (i32.add
                  (local.get $p0)
                  (i32.const 9)))
              (i32.gt_s
                (local.get $p0)
                (local.get $l1)))
            (i32.const 1)))
        (local.set $l1
          (i32.add
            (i32.shl
              (local.get $p0)
              (i32.const 6))
            (i32.const 8305)))
        (loop $L8
          (block $B9
            (br_if $B9
              (i32.gt_u
                (local.get $p0)
                (i32.const 47)))
            (i32.store16
              (i32.add
                (local.get $l1)
                (i32.const -1))
              (i32.const 1028)))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L8
            (i32.ne
              (local.get $l2)
              (local.tee $p0
                (i32.add
                  (local.get $p0)
                  (i32.const 1))))))
        (local.set $l4
          (select
            (local.tee $l3
              (i32.load offset=8200
                (i32.const 0)))
            (local.tee $p0
              (i32.add
                (local.get $l3)
                (i32.const 2)))
            (i32.gt_s
              (local.get $l3)
              (local.get $p0))))
        (local.set $l1
          (i32.add
            (select
              (local.tee $l5
                (i32.load offset=8196
                  (i32.const 0)))
              (local.tee $p0
                (i32.add
                  (local.get $l5)
                  (i32.const 2)))
              (i32.gt_s
                (local.get $l5)
                (local.get $p0)))
            (i32.const 1)))
        (local.set $l2
          (i32.or
            (i32.shl
              (local.get $l3)
              (i32.const 6))
            (i32.const 52)))
        (loop $L10
          (block $B11
            (br_if $B11
              (i32.gt_u
                (local.get $l3)
                (i32.const 47)))
            (local.set $p0
              (local.get $l5))
            (loop $L12
              (block $B13
                (br_if $B13
                  (i32.gt_u
                    (local.get $p0)
                    (i32.const 63)))
                (i32.store8
                  (i32.add
                    (i32.add
                      (local.get $l2)
                      (local.get $p0))
                    (i32.const 8192))
                  (i32.const 2)))
              (br_if $L12
                (i32.ne
                  (local.get $l1)
                  (local.tee $p0
                    (i32.add
                      (local.get $p0)
                      (i32.const 1)))))))
          (local.set $l2
            (i32.add
              (local.get $l2)
              (i32.const 64)))
          (local.set $p0
            (i32.eq
              (local.get $l3)
              (local.get $l4)))
          (local.set $l3
            (i32.add
              (local.get $l3)
              (i32.const 1)))
          (br_if $L10
            (i32.eqz
              (local.get $p0)))
          (br $B0)))
      (i32.store offset=8220
        (i32.const 0)
        (local.tee $l6
          (i32.load offset=8196
            (i32.const 0))))
      (i32.store offset=8224
        (i32.const 0)
        (local.tee $l3
          (i32.load offset=8200
            (i32.const 0))))
      (i32.store offset=8228
        (i32.const 0)
        (local.tee $l7
          (i32.load offset=8212
            (i32.const 0))))
      (i32.store offset=8232
        (i32.const 0)
        (local.tee $l5
          (i32.load offset=8216
            (i32.const 0))))
      (block $B14
        (block $B15
          (block $B16
            (br_if $B16
              (i32.ne
                (local.get $p0)
                (i32.const 1)))
            (local.set $l1
              (i32.const -2))
            (br_if $B15
              (i32.gt_s
                (local.get $l7)
                (i32.const 0))))
          (local.set $l1
            (i32.const 2))
          (local.set $l4
            (local.get $l7))
          (br_if $B14
            (i32.ne
              (local.get $p0)
              (i32.const 2)))
          (local.set $l4
            (local.get $l7))
          (br_if $B14
            (i32.gt_s
              (local.get $l7)
              (i32.const 37))))
        (i32.store offset=8212
          (i32.const 0)
          (local.tee $l4
            (i32.add
              (local.get $l1)
              (local.get $l7)))))
      (local.set $l2
        (i32.sub
          (local.tee $l2
            (i32.add
              (local.get $l5)
              (local.tee $p0
                (i32.and
                  (i32.lt_s
                    (local.get $l5)
                    (i32.const 38))
                  (i32.lt_s
                    (local.tee $l1
                      (i32.add
                        (local.get $l5)
                        (i32.const 5)))
                    (local.get $l3))))))
          (local.tee $l1
            (i32.and
              (i32.gt_s
                (select
                  (i32.add
                    (local.get $l5)
                    (i32.const 6))
                  (local.get $l1)
                  (local.get $p0))
                (local.get $l3))
              (i32.gt_s
                (local.get $l2)
                (i32.const 0))))))
      (block $B17
        (block $B18
          (br_if $B18
            (local.get $p0))
          (local.set $l8
            (local.get $l5))
          (br_if $B17
            (i32.eqz
              (local.get $l1))))
        (i32.store offset=8216
          (i32.const 0)
          (local.get $l2))
        (local.set $l8
          (local.get $l2)))
      (local.set $l10
        (i32.lt_s
          (local.tee $l9
            (select
              (local.tee $l1
                (i32.add
                  (i32.load offset=8208
                    (i32.const 0))
                  (local.get $l3)))
              (i32.const 0)
              (i32.gt_s
                (local.get $l1)
                (i32.const 0))))
          (i32.const 45)))
      (local.set $p0
        (i32.add
          (local.tee $l11
            (i32.load offset=8204
              (i32.const 0)))
          (local.get $l6)))
      (block $B19
        (br_if $B19
          (i32.lt_u
            (local.get $l1)
            (i32.const 46)))
        (i32.store offset=8208
          (i32.const 0)
          (select
            (i32.const -1)
            (i32.const 1)
            (i32.gt_s
              (local.get $l1)
              (i32.const 45)))))
      (local.set $l12
        (i32.load offset=8240
          (i32.const 0)))
      (local.set $l13
        (i32.load offset=8236
          (i32.const 0)))
      (local.set $l1
        (select
          (local.get $l9)
          (i32.const 45)
          (local.get $l10)))
      (block $B20
        (block $B21
          (block $B22
            (block $B23
              (block $B24
                (br_if $B24
                  (i32.gt_s
                    (local.get $p0)
                    (i32.const 4)))
                (br_if $B23
                  (i32.le_s
                    (i32.add
                      (local.get $l1)
                      (i32.const 3))
                    (local.get $l4)))
                (br_if $B23
                  (i32.ge_s
                    (local.get $l1)
                    (i32.add
                      (local.get $l4)
                      (i32.const 10))))
                (local.set $l2
                  (i32.const 1))
                (local.set $l14
                  (local.get $l12))
                (local.set $l10
                  (local.get $l13))
                (local.set $p0
                  (i32.const 4))
                (br $B21))
              (block $B25
                (br_if $B25
                  (i32.ge_u
                    (local.get $p0)
                    (i32.const 57)))
                (local.set $l14
                  (local.get $l12))
                (local.set $l10
                  (local.get $l13))
                (br $B20))
              (block $B26
                (br_if $B26
                  (i32.le_s
                    (i32.add
                      (local.get $l1)
                      (i32.const 3))
                    (local.get $l2)))
                (br_if $B26
                  (i32.ge_s
                    (local.get $l1)
                    (i32.add
                      (local.get $l2)
                      (i32.const 10))))
                (local.set $l2
                  (i32.const -1))
                (local.set $l14
                  (local.get $l12))
                (local.set $l10
                  (local.get $l13))
                (local.set $p0
                  (i32.const 57))
                (br $B21))
              (local.set $l14
                (local.get $l12))
              (local.set $l10
                (local.get $l13))
              (br_if $B20
                (i32.lt_u
                  (local.get $p0)
                  (i32.const 62)))
              (i32.store offset=8236
                (i32.const 0)
                (local.tee $l10
                  (i32.add
                    (local.get $l13)
                    (i32.const 1))))
              (local.set $l14
                (local.get $l12))
              (br $B22))
            (local.set $l14
              (local.get $l12))
            (local.set $l10
              (local.get $l13))
            (br_if $B20
              (i32.ge_s
                (local.get $p0)
                (i32.const 0)))
            (i32.store offset=8240
              (i32.const 0)
              (local.tee $l14
                (i32.add
                  (local.get $l12)
                  (i32.const 1))))
            (local.set $l10
              (local.get $l13)))
          (local.set $l2
            (i32.sub
              (i32.const 0)
              (local.get $l11)))
          (local.set $l1
            (i32.const 24))
          (local.set $p0
            (i32.const 32)))
        (i32.store offset=8204
          (i32.const 0)
          (local.get $l2)))
      (i32.store offset=8200
        (i32.const 0)
        (local.get $l1))
      (i32.store offset=8196
        (i32.const 0)
        (local.get $p0))
      (local.set $l9
        (select
          (local.get $l3)
          (local.tee $p0
            (i32.add
              (local.get $l3)
              (i32.const 2)))
          (i32.gt_s
            (local.get $l3)
            (local.get $p0))))
      (local.set $l1
        (i32.add
          (select
            (local.get $l6)
            (local.tee $p0
              (i32.add
                (local.get $l6)
                (i32.const 2)))
            (i32.gt_s
              (local.get $l6)
              (local.get $p0)))
          (i32.const 1)))
      (local.set $l2
        (i32.or
          (i32.shl
            (local.get $l3)
            (i32.const 6))
          (i32.const 52)))
      (loop $L27
        (block $B28
          (br_if $B28
            (i32.gt_u
              (local.get $l3)
              (i32.const 47)))
          (local.set $p0
            (local.get $l6))
          (loop $L29
            (block $B30
              (br_if $B30
                (i32.gt_u
                  (local.get $p0)
                  (i32.const 63)))
              (i32.store8
                (i32.add
                  (i32.add
                    (local.get $l2)
                    (local.get $p0))
                  (i32.const 8192))
                (i32.const 0)))
            (br_if $L29
              (i32.ne
                (local.get $l1)
                (local.tee $p0
                  (i32.add
                    (local.get $p0)
                    (i32.const 1)))))))
        (local.set $l2
          (i32.add
            (local.get $l2)
            (i32.const 64)))
        (local.set $p0
          (i32.ne
            (local.get $l3)
            (local.get $l9)))
        (local.set $l3
          (i32.add
            (local.get $l3)
            (i32.const 1)))
        (br_if $L27
          (local.get $p0)))
      (block $B31
        (br_if $B31
          (i32.eq
            (local.get $l7)
            (local.get $l4)))
        (local.set $l1
          (i32.add
            (select
              (local.get $l7)
              (local.tee $p0
                (i32.add
                  (local.get $l7)
                  (i32.const 9)))
              (i32.gt_s
                (local.get $l7)
                (local.get $p0)))
            (i32.const 1)))
        (local.set $p0
          (i32.add
            (i32.shl
              (local.get $l7)
              (i32.const 6))
            (i32.const 8247)))
        (loop $L32
          (block $B33
            (br_if $B33
              (i32.gt_u
                (local.get $l7)
                (i32.const 47)))
            (i32.store16
              (i32.add
                (local.get $p0)
                (i32.const -1))
              (i32.const 0)))
          (local.set $p0
            (i32.add
              (local.get $p0)
              (i32.const 64)))
          (br_if $L32
            (i32.ne
              (local.get $l1)
              (local.tee $l7
                (i32.add
                  (local.get $l7)
                  (i32.const 1)))))))
      (block $B34
        (br_if $B34
          (i32.eq
            (local.get $l5)
            (local.get $l8)))
        (local.set $l1
          (i32.add
            (select
              (local.get $l5)
              (local.tee $p0
                (i32.add
                  (local.get $l5)
                  (i32.const 9)))
              (i32.gt_s
                (local.get $l5)
                (local.get $p0)))
            (i32.const 1)))
        (local.set $p0
          (i32.add
            (i32.shl
              (local.get $l5)
              (i32.const 6))
            (i32.const 8305)))
        (loop $L35
          (block $B36
            (br_if $B36
              (i32.gt_u
                (local.get $l5)
                (i32.const 47)))
            (i32.store16
              (i32.add
                (local.get $p0)
                (i32.const -1))
              (i32.const 0)))
          (local.set $p0
            (i32.add
              (local.get $p0)
              (i32.const 64)))
          (br_if $L35
            (i32.ne
              (local.get $l1)
              (local.tee $l5
                (i32.add
                  (local.get $l5)
                  (i32.const 1)))))))
      (local.set $p0
        (i32.const 0))
      (local.set $l1
        (i32.const 8276))
      (loop $L37
        (block $B38
          (br_if $B38
            (i32.and
              (i32.div_u
                (i32.and
                  (local.get $p0)
                  (i32.const 255))
                (i32.const 3))
              (i32.const 1)))
          (i32.store8
            (local.get $l1)
            (i32.const 1)))
        (local.set $l1
          (i32.add
            (local.get $l1)
            (i32.const 64)))
        (br_if $L37
          (i32.ne
            (local.tee $p0
              (i32.add
                (local.get $p0)
                (i32.const 1)))
            (i32.const 48))))
      (block $B39
        (block $B40
          (br_if $B40
            (i32.ne
              (local.get $l10)
              (local.get $l13)))
          (br_if $B39
            (i32.eq
              (local.get $l14)
              (local.get $l12))))
        (call $f1)
        (local.set $l4
          (i32.load offset=8212
            (i32.const 0))))
      (local.set $l1
        (i32.add
          (select
            (local.get $l4)
            (local.tee $p0
              (i32.add
                (local.get $l4)
                (i32.const 9)))
            (i32.gt_s
              (local.get $l4)
              (local.get $p0)))
          (i32.const 1)))
      (local.set $p0
        (i32.add
          (i32.shl
            (local.get $l4)
            (i32.const 6))
          (i32.const 8247)))
      (loop $L41
        (block $B42
          (br_if $B42
            (i32.gt_u
              (local.get $l4)
              (i32.const 47)))
          (i32.store16
            (i32.add
              (local.get $p0)
              (i32.const -1))
            (i32.const 771)))
        (local.set $p0
          (i32.add
            (local.get $p0)
            (i32.const 64)))
        (br_if $L41
          (i32.ne
            (local.get $l1)
            (local.tee $l4
              (i32.add
                (local.get $l4)
                (i32.const 1))))))
      (local.set $l2
        (i32.add
          (select
            (local.tee $p0
              (i32.load offset=8216
                (i32.const 0)))
            (local.tee $l1
              (i32.add
                (local.get $p0)
                (i32.const 9)))
            (i32.gt_s
              (local.get $p0)
              (local.get $l1)))
          (i32.const 1)))
      (local.set $l1
        (i32.add
          (i32.shl
            (local.get $p0)
            (i32.const 6))
          (i32.const 8305)))
      (loop $L43
        (block $B44
          (br_if $B44
            (i32.gt_u
              (local.get $p0)
              (i32.const 47)))
          (i32.store16
            (i32.add
              (local.get $l1)
              (i32.const -1))
            (i32.const 1028)))
        (local.set $l1
          (i32.add
            (local.get $l1)
            (i32.const 64)))
        (br_if $L43
          (i32.ne
            (local.get $l2)
            (local.tee $p0
              (i32.add
                (local.get $p0)
                (i32.const 1))))))
      (local.set $l4
        (select
          (local.tee $l3
            (i32.load offset=8200
              (i32.const 0)))
          (local.tee $p0
            (i32.add
              (local.get $l3)
              (i32.const 2)))
          (i32.gt_s
            (local.get $l3)
            (local.get $p0))))
      (local.set $l1
        (i32.add
          (select
            (local.tee $l5
              (i32.load offset=8196
                (i32.const 0)))
            (local.tee $p0
              (i32.add
                (local.get $l5)
                (i32.const 2)))
            (i32.gt_s
              (local.get $l5)
              (local.get $p0)))
          (i32.const 1)))
      (local.set $l2
        (i32.or
          (i32.shl
            (local.get $l3)
            (i32.const 6))
          (i32.const 52)))
      (loop $L45
        (block $B46
          (br_if $B46
            (i32.gt_u
              (local.get $l3)
              (i32.const 47)))
          (local.set $p0
            (local.get $l5))
          (loop $L47
            (block $B48
              (br_if $B48
                (i32.gt_u
                  (local.get $p0)
                  (i32.const 63)))
              (i32.store8
                (i32.add
                  (i32.add
                    (local.get $l2)
                    (local.get $p0))
                  (i32.const 8192))
                (i32.const 2)))
            (br_if $L47
              (i32.ne
                (local.get $l1)
                (local.tee $p0
                  (i32.add
                    (local.get $p0)
                    (i32.const 1)))))))
        (local.set $l2
          (i32.add
            (local.get $l2)
            (i32.const 64)))
        (local.set $p0
          (i32.ne
            (local.get $l3)
            (local.get $l4)))
        (local.set $l3
          (i32.add
            (local.get $l3)
            (i32.const 1)))
        (br_if $L45
          (local.get $p0))))
    (i32.const 8244))
  (func $f1 (type $t1)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32)
    (local.set $l0
      (i32.const 2))
    (local.set $l1
      (i32.const 8390))
    (loop $L0
      (local.set $l2
        (i32.const 0))
      (loop $L1
        (i32.store8
          (i32.add
            (local.get $l1)
            (local.get $l2))
          (i32.const 0))
        (br_if $L1
          (i32.ne
            (local.tee $l2
              (i32.add
                (local.get $l2)
                (i32.const 1)))
            (i32.const 12))))
      (local.set $l1
        (i32.add
          (local.get $l1)
          (i32.const 64)))
      (br_if $L0
        (i32.ne
          (local.tee $l0
            (i32.add
              (local.get $l0)
              (i32.const 1)))
          (i32.const 4))))
    (local.set $l0
      (i32.const 2))
    (local.set $l1
      (i32.const 8407))
    (loop $L2
      (local.set $l2
        (i32.const 0))
      (loop $L3
        (i32.store8
          (i32.add
            (local.get $l1)
            (local.get $l2))
          (i32.const 0))
        (br_if $L3
          (i32.ne
            (local.tee $l2
              (i32.add
                (local.get $l2)
                (i32.const 1)))
            (i32.const 12))))
      (local.set $l1
        (i32.add
          (local.get $l1)
          (i32.const 64)))
      (br_if $L2
        (i32.ne
          (local.tee $l0
            (i32.add
              (local.get $l0)
              (i32.const 1)))
          (i32.const 4))))
    (block $B4
      (br_if $B4
        (i32.lt_s
          (local.tee $l2
            (i32.load offset=8236
              (i32.const 0)))
          (i32.const 1)))
      (local.set $l3
        (select
          (local.get $l2)
          (i32.const 4)
          (i32.lt_s
            (local.get $l2)
            (i32.const 4))))
      (local.set $l4
        (i32.const 8399))
      (local.set $l5
        (i32.const 0))
      (loop $L5
        (local.set $l1
          (local.get $l4))
        (local.set $l0
          (i32.const 2))
        (loop $L6
          (local.set $l2
            (i32.const 0))
          (loop $L7
            (i32.store8
              (i32.add
                (local.get $l1)
                (local.get $l2))
              (i32.const 5))
            (br_if $L7
              (i32.ne
                (local.tee $l2
                  (i32.add
                    (local.get $l2)
                    (i32.const 1)))
                (i32.const 2))))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L6
            (i32.ne
              (local.tee $l0
                (i32.add
                  (local.get $l0)
                  (i32.const 1)))
              (i32.const 4))))
        (local.set $l4
          (i32.add
            (local.get $l4)
            (i32.const -3)))
        (br_if $L5
          (i32.ne
            (local.tee $l5
              (i32.add
                (local.get $l5)
                (i32.const 1)))
            (local.get $l3)))))
    (block $B8
      (br_if $B8
        (i32.lt_s
          (local.tee $l2
            (i32.load offset=8240
              (i32.const 0)))
          (i32.const 1)))
      (local.set $l3
        (select
          (local.get $l2)
          (i32.const 4)
          (i32.lt_s
            (local.get $l2)
            (i32.const 4))))
      (local.set $l5
        (i32.const 0))
      (local.set $l4
        (i32.const 8408))
      (loop $L9
        (local.set $l1
          (local.get $l4))
        (local.set $l0
          (i32.const 2))
        (loop $L10
          (local.set $l2
            (i32.const 0))
          (loop $L11
            (i32.store8
              (i32.add
                (local.get $l1)
                (local.get $l2))
              (i32.const 5))
            (br_if $L11
              (i32.ne
                (local.tee $l2
                  (i32.add
                    (local.get $l2)
                    (i32.const 1)))
                (i32.const 2))))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L10
            (i32.ne
              (local.tee $l0
                (i32.add
                  (local.get $l0)
                  (i32.const 1)))
              (i32.const 4))))
        (local.set $l4
          (i32.add
            (local.get $l4)
            (i32.const 3)))
        (br_if $L9
          (i32.ne
            (local.tee $l5
              (i32.add
                (local.get $l5)
                (i32.const 1)))
            (local.get $l3))))))
  (func $score1 (export "score1") (type $t2) (result i32)
    (i32.load offset=8236
      (i32.const 0)))
  (func $score2 (export "score2") (type $t2) (result i32)
    (i32.load offset=8240
      (i32.const 0)))
  (table $T0 1 1 funcref)
  (global $g0 (mut i32) (i32.const 8192))
  (data $d0 (i32.const 8192) "\00\00\00\00 \00\00\00\18\00\00\00\01\00\00\00\01\00\00\00\13\00\00\00\13\00\00\00 \00\00\00\18\00\00\00\13\00\00\00\13\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00"))
