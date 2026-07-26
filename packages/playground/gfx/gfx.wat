(module
  (type $t0 (func (param i32) (result i32)))
  (type $t1 (func))
  (type $t2 (func (result i32)))
  (memory $env.memory (import "env" "memory") 1)
  (func $frame (export "frame") (type $t0) (param $p0 i32) (result i32)
    (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32) (local $l7 i32) (local $l8 i32) (local $l9 i32) (local $l10 i32)
    (block $B0
      (block $B1
        (br_if $B1
          (i32.load offset=8192
            (i32.const 0)))
        (i32.store offset=8192
          (i32.const 0)
          (i32.const 1))
        (local.set $l1
          (i32.const 8292))
        (local.set $p0
          (i32.const 0))
        (loop $L2
          (local.set $l2
            (i32.const 0))
          (loop $L3
            (i32.store
              (i32.add
                (local.get $l1)
                (local.get $l2))
              (i32.const 0))
            (local.set $l3
              (i32.lt_u
                (local.get $l2)
                (i32.const 60)))
            (local.set $l2
              (i32.add
                (local.get $l2)
                (i32.const 4)))
            (br_if $L3
              (local.get $l3)))
          (local.set $l1
            (i32.add
              (local.get $l1)
              (i32.const 64)))
          (br_if $L2
            (i32.ne
              (local.tee $p0
                (i32.add
                  (local.get $p0)
                  (i32.const 1)))
              (i32.const 48))))
        (local.set $l2
          (i32.const 0))
        (loop $L4
          (i32.store8
            (i32.add
              (local.get $l2)
              (i32.const 8244))
            (i32.and
              (i32.xor
                (i32.div_u
                  (i32.and
                    (local.get $l2)
                    (i32.const 255))
                  (i32.const 3))
                (i32.const -1))
              (i32.const 1)))
          (br_if $L4
            (i32.ne
              (local.tee $l2
                (i32.add
                  (local.get $l2)
                  (i32.const 1)))
              (i32.const 48))))
        (local.set $l2
          (i32.const 52))
        (local.set $l3
          (i32.const 8324))
        (loop $L5
          (i32.store8
            (local.get $l3)
            (i32.load8_u
              (i32.add
                (local.get $l2)
                (i32.const 8192))))
          (local.set $l3
            (i32.add
              (local.get $l3)
              (i32.const 64)))
          (br_if $L5
            (i32.ne
              (local.tee $l2
                (i32.add
                  (local.get $l2)
                  (i32.const 1)))
              (i32.const 100))))
        (call $f1)
        (i32.store
          (i32.add
            (local.tee $l2
              (i32.shl
                (select
                  (local.tee $l2
                    (select
                      (local.tee $l2
                        (i32.load offset=8212
                          (i32.const 0)))
                      (i32.const 0)
                      (i32.gt_s
                        (local.get $l2)
                        (i32.const 0))))
                  (i32.const 38)
                  (i32.lt_s
                    (local.get $l2)
                    (i32.const 38)))
                (i32.const 6)))
            (i32.const 8872))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8808))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8744))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8680))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8616))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8552))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8488))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8424))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8360))
          (i32.const 50529027))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8296))
          (i32.const 50529027))
        (local.set $p0
          (i32.load offset=8216
            (i32.const 0)))
        (br $B0))
      (i32.store offset=8220
        (i32.const 0)
        (local.tee $l4
          (i32.load offset=8196
            (i32.const 0))))
      (i32.store offset=8224
        (i32.const 0)
        (local.tee $l2
          (i32.load offset=8200
            (i32.const 0))))
      (i32.store offset=8228
        (i32.const 0)
        (local.tee $l1
          (i32.load offset=8212
            (i32.const 0))))
      (i32.store offset=8232
        (i32.const 0)
        (local.tee $l3
          (i32.load offset=8216
            (i32.const 0))))
      (block $B6
        (block $B7
          (block $B8
            (br_if $B8
              (i32.ne
                (local.get $p0)
                (i32.const 1)))
            (local.set $l5
              (i32.const -2))
            (br_if $B7
              (i32.gt_s
                (local.get $l1)
                (i32.const 0))))
          (local.set $l5
            (i32.const 2))
          (br_if $B6
            (i32.ne
              (local.get $p0)
              (i32.const 2)))
          (br_if $B6
            (i32.gt_s
              (local.get $l1)
              (i32.const 37))))
        (i32.store offset=8212
          (i32.const 0)
          (local.tee $l1
            (i32.add
              (local.get $l5)
              (local.get $l1)))))
      (local.set $l7
        (i32.sub
          (local.tee $l6
            (i32.add
              (local.get $l3)
              (local.tee $p0
                (i32.and
                  (i32.lt_s
                    (local.get $l3)
                    (i32.const 38))
                  (i32.lt_s
                    (local.tee $l5
                      (i32.add
                        (local.get $l3)
                        (i32.const 5)))
                    (local.get $l2))))))
          (local.tee $l3
            (i32.and
              (i32.gt_s
                (select
                  (i32.add
                    (local.get $l3)
                    (i32.const 6))
                  (local.get $l5)
                  (local.get $p0))
                (local.get $l2))
              (i32.gt_s
                (local.get $l6)
                (i32.const 0))))))
      (block $B9
        (block $B10
          (br_if $B10
            (local.get $p0))
          (br_if $B9
            (i32.eqz
              (local.get $l3))))
        (i32.store offset=8216
          (i32.const 0)
          (local.get $l7)))
      (local.set $l8
        (i32.lt_s
          (local.tee $l6
            (select
              (local.tee $p0
                (i32.add
                  (i32.load offset=8208
                    (i32.const 0))
                  (local.get $l2)))
              (i32.const 0)
              (i32.gt_s
                (local.get $p0)
                (i32.const 0))))
          (i32.const 45)))
      (local.set $l3
        (i32.add
          (local.tee $l9
            (i32.load offset=8204
              (i32.const 0)))
          (local.get $l4)))
      (block $B11
        (br_if $B11
          (i32.lt_u
            (local.get $p0)
            (i32.const 46)))
        (i32.store offset=8208
          (i32.const 0)
          (select
            (i32.const -1)
            (i32.const 1)
            (i32.gt_s
              (local.get $p0)
              (i32.const 45)))))
      (local.set $l10
        (i32.load offset=8240
          (i32.const 0)))
      (local.set $l5
        (i32.load offset=8236
          (i32.const 0)))
      (local.set $p0
        (select
          (local.get $l6)
          (i32.const 45)
          (local.get $l8)))
      (block $B12
        (block $B13
          (block $B14
            (block $B15
              (block $B16
                (br_if $B16
                  (i32.gt_s
                    (local.get $l3)
                    (i32.const 8)))
                (br_if $B15
                  (i32.le_s
                    (i32.add
                      (local.get $p0)
                      (i32.const 3))
                    (local.get $l1)))
                (br_if $B15
                  (i32.ge_s
                    (local.get $p0)
                    (i32.add
                      (local.get $l1)
                      (i32.const 10))))
                (local.set $l1
                  (i32.const 1))
                (local.set $l3
                  (i32.const 8))
                (br $B13))
              (br_if $B12
                (i32.lt_u
                  (local.get $l3)
                  (i32.const 53)))
              (block $B17
                (br_if $B17
                  (i32.le_s
                    (i32.add
                      (local.get $p0)
                      (i32.const 3))
                    (local.get $l7)))
                (br_if $B17
                  (i32.ge_s
                    (local.get $p0)
                    (i32.add
                      (local.get $l7)
                      (i32.const 10))))
                (local.set $l1
                  (i32.const -1))
                (local.set $l3
                  (i32.const 53))
                (br $B13))
              (br_if $B12
                (i32.lt_u
                  (local.get $l3)
                  (i32.const 62)))
              (i32.store offset=8236
                (i32.const 0)
                (i32.add
                  (local.get $l5)
                  (i32.const 1)))
              (br $B14))
            (br_if $B12
              (i32.ge_s
                (local.get $l3)
                (i32.const 0)))
            (i32.store offset=8240
              (i32.const 0)
              (i32.add
                (local.get $l10)
                (i32.const 1))))
          (local.set $l1
            (i32.sub
              (i32.const 0)
              (local.get $l9)))
          (local.set $p0
            (i32.const 24))
          (local.set $l3
            (i32.const 32)))
        (i32.store offset=8204
          (i32.const 0)
          (local.get $l1)))
      (i32.store offset=8200
        (i32.const 0)
        (local.get $p0))
      (i32.store offset=8196
        (i32.const 0)
        (local.get $l3))
      (i32.store8
        (i32.add
          (local.tee $l2
            (i32.add
              (i32.shl
                (local.get $l2)
                (i32.const 6))
              (local.get $l4)))
          (i32.const 8422))
        (i32.const 0))
      (i32.store16 align=1
        (i32.add
          (local.get $l2)
          (i32.const 8420))
        (i32.const 0))
      (i32.store8
        (i32.add
          (local.get $l2)
          (i32.const 8358))
        (i32.const 0))
      (i32.store16 align=1
        (i32.add
          (local.get $l2)
          (i32.const 8356))
        (i32.const 0))
      (i32.store8
        (i32.add
          (local.get $l2)
          (i32.const 8294))
        (i32.const 0))
      (i32.store16 align=1
        (i32.add
          (local.get $l2)
          (i32.const 8292))
        (i32.const 0))
      (block $B18
        (br_if $B18
          (i32.eq
            (local.tee $l2
              (i32.load offset=8228
                (i32.const 0)))
            (local.tee $l4
              (i32.load offset=8212
                (i32.const 0)))))
        (i32.store
          (i32.add
            (local.tee $l2
              (i32.shl
                (select
                  (local.tee $l2
                    (select
                      (local.get $l2)
                      (i32.const 0)
                      (i32.gt_s
                        (local.get $l2)
                        (i32.const 0))))
                  (i32.const 38)
                  (i32.lt_s
                    (local.get $l2)
                    (i32.const 38)))
                (i32.const 6)))
            (i32.const 8872))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8808))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8744))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8680))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8616))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8552))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8488))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8424))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8360))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8296))
          (i32.const 0)))
      (block $B19
        (br_if $B19
          (i32.eq
            (local.tee $l2
              (i32.load offset=8232
                (i32.const 0)))
            (local.tee $p0
              (i32.load offset=8216
                (i32.const 0)))))
        (i32.store
          (i32.add
            (local.tee $l2
              (i32.shl
                (select
                  (local.tee $l2
                    (select
                      (local.get $l2)
                      (i32.const 0)
                      (i32.gt_s
                        (local.get $l2)
                        (i32.const 0))))
                  (i32.const 38)
                  (i32.lt_s
                    (local.get $l2)
                    (i32.const 38)))
                (i32.const 6)))
            (i32.const 8924))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8860))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8796))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8732))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8668))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8604))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8540))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8476))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8412))
          (i32.const 0))
        (i32.store
          (i32.add
            (local.get $l2)
            (i32.const 8348))
          (i32.const 0)))
      (local.set $l1
        (i32.add
          (select
            (local.tee $l2
              (i32.load offset=8224
                (i32.const 0)))
            (local.tee $l3
              (i32.add
                (local.get $l2)
                (i32.const 2)))
            (i32.gt_s
              (local.get $l2)
              (local.get $l3)))
          (i32.const 1)))
      (local.set $l3
        (i32.add
          (i32.shl
            (local.get $l2)
            (i32.const 6))
          (i32.const 8324)))
      (loop $L20
        (block $B21
          (br_if $B21
            (i32.gt_u
              (local.get $l2)
              (i32.const 47)))
          (i32.store8
            (local.get $l3)
            (i32.load8_u
              (i32.add
                (local.get $l2)
                (i32.const 8244)))))
        (local.set $l3
          (i32.add
            (local.get $l3)
            (i32.const 64)))
        (br_if $L20
          (i32.ne
            (local.get $l1)
            (local.tee $l2
              (i32.add
                (local.get $l2)
                (i32.const 1))))))
      (block $B22
        (block $B23
          (br_if $B23
            (i32.ne
              (i32.load offset=8236
                (i32.const 0))
              (local.get $l5)))
          (br_if $B22
            (i32.eq
              (i32.load offset=8240
                (i32.const 0))
              (local.get $l10))))
        (call $f1)
        (local.set $p0
          (i32.load offset=8216
            (i32.const 0)))
        (local.set $l4
          (i32.load offset=8212
            (i32.const 0))))
      (i32.store
        (i32.add
          (local.tee $l2
            (i32.shl
              (select
                (local.tee $l2
                  (select
                    (local.get $l4)
                    (i32.const 0)
                    (i32.gt_s
                      (local.get $l4)
                      (i32.const 0))))
                (i32.const 38)
                (i32.lt_s
                  (local.get $l2)
                  (i32.const 38)))
              (i32.const 6)))
          (i32.const 8872))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8808))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8744))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8680))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8616))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8552))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8488))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8424))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8360))
        (i32.const 50529027))
      (i32.store
        (i32.add
          (local.get $l2)
          (i32.const 8296))
        (i32.const 50529027)))
    (i32.store
      (i32.add
        (local.tee $l2
          (i32.shl
            (select
              (local.tee $l2
                (select
                  (local.get $p0)
                  (i32.const 0)
                  (i32.gt_s
                    (local.get $p0)
                    (i32.const 0))))
              (i32.const 38)
              (i32.lt_s
                (local.get $l2)
                (i32.const 38)))
            (i32.const 6)))
        (i32.const 8924))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8860))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8796))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8732))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8668))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8604))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8540))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8476))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8412))
      (i32.const 67372036))
    (i32.store
      (i32.add
        (local.get $l2)
        (i32.const 8348))
      (i32.const 67372036))
    (i32.store8
      (i32.add
        (local.tee $l2
          (i32.add
            (i32.shl
              (i32.load offset=8200
                (i32.const 0))
              (i32.const 6))
            (i32.load offset=8196
              (i32.const 0))))
        (i32.const 8422))
      (i32.const 2))
    (i32.store16 align=1
      (i32.add
        (local.get $l2)
        (i32.const 8420))
      (i32.const 514))
    (i32.store8
      (i32.add
        (local.get $l2)
        (i32.const 8358))
      (i32.const 2))
    (i32.store16 align=1
      (i32.add
        (local.get $l2)
        (i32.const 8356))
      (i32.const 514))
    (i32.store8
      (i32.add
        (local.get $l2)
        (i32.const 8294))
      (i32.const 2))
    (i32.store16 align=1
      (i32.add
        (local.get $l2)
        (i32.const 8292))
      (i32.const 514))
    (i32.const 8292))
  (func $f1 (type $t1)
    (local $l0 i32) (local $l1 i32) (local $l2 i32) (local $l3 i32) (local $l4 i32) (local $l5 i32)
    (local.set $l0
      (i32.const 2))
    (local.set $l1
      (i32.const 8438))
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
      (i32.const 8455))
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
        (i32.const 8447))
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
        (i32.const 8456))
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
  (data $d0 (i32.const 8192) "\00\00\00\00 \00\00\00\18\00\00\00\01\00\00\00\01\00\00\00\13\00\00\00\13\00\00\00 \00\00\00\18\00\00\00\13\00\00\00\13\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00"))
