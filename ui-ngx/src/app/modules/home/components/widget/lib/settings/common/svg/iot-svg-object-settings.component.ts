///
/// Copyright © 2016-2024 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import { ChangeDetectorRef, Component, forwardRef, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  UntypedFormBuilder,
  UntypedFormControl,
  UntypedFormGroup,
  Validator,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import {
  defaultIotSvgObjectSettings,
  IotSvgBehaviorType,
  IotSvgMetadata,
  IotSvgObjectSettings,
  IotSvgPropertyType,
  parseIotSvgMetadataFromContent
} from '@home/components/widget/lib/svg/iot-svg.models';
import { HttpClient } from '@angular/common/http';
import { IAliasController } from '@core/api/widget-api.models';
import { TargetDevice, widgetType } from '@shared/models/widget.models';
import { isDefinedAndNotNull, mergeDeep } from '@core/utils';
import {
  IotSvgPropertyRow,
  toPropertyRows
} from '@home/components/widget/lib/settings/common/svg/iot-svg-object-settings.models';
import { merge, Observable, of, Subscription } from 'rxjs';
import { WidgetActionCallbacks } from '@home/components/widget/action/manage-widget-actions.component.models';
import { ImageService } from '@core/http/image.service';

@Component({
  selector: 'tb-iot-svg-object-settings',
  templateUrl: './iot-svg-object-settings.component.html',
  styleUrls: ['./iot-svg-object-settings.component.scss', './../../widget-settings.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IotSvgObjectSettingsComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => IotSvgObjectSettingsComponent),
      multi: true
    }
  ]
})
export class IotSvgObjectSettingsComponent implements OnInit, OnChanges, ControlValueAccessor, Validator {

  IotSvgBehaviorType = IotSvgBehaviorType;

  IotSvgPropertyType = IotSvgPropertyType;

  @Input()
  disabled: boolean;

  @Input()
  svgPath = 'drawing.svg';

  @Input()
  svgUrl: string;

  @Input()
  svgContent: string;

  @Input()
  aliasController: IAliasController;

  @Input()
  targetDevice: TargetDevice;

  @Input()
  callbacks: WidgetActionCallbacks;

  @Input()
  widgetType: widgetType;

  private modelValue: IotSvgObjectSettings;

  private propagateChange = null;

  private validatorTriggers: string[];
  private validatorSubscription: Subscription;

  public iotSvgObjectSettingsFormGroup: UntypedFormGroup;

  metadata: IotSvgMetadata;
  propertyRows: IotSvgPropertyRow[];

  constructor(protected store: Store<AppState>,
              private fb: UntypedFormBuilder,
              private http: HttpClient,
              private imageService: ImageService,
              private cd: ChangeDetectorRef) {
  }

  ngOnInit(): void {
    this.iotSvgObjectSettingsFormGroup = this.fb.group({
      behavior: this.fb.group({}),
      properties: this.fb.group({})
    });
    this.iotSvgObjectSettingsFormGroup.valueChanges.subscribe(() => {
      this.updateModel();
    });
    this.loadMetadata();
  }

  ngOnChanges(changes: SimpleChanges): void {
    for (const propName of Object.keys(changes)) {
      const change = changes[propName];
      if (!change.firstChange && change.currentValue !== change.previousValue) {
        if (['svgPath', 'svgUrl', 'svgContent'].includes(propName)) {
          this.loadMetadata();
        }
      }
    }
  }

  registerOnChange(fn: any): void {
    this.propagateChange = fn;
  }

  registerOnTouched(_fn: any): void {
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (isDisabled) {
      this.iotSvgObjectSettingsFormGroup.disable({emitEvent: false});
    } else {
      this.iotSvgObjectSettingsFormGroup.enable({emitEvent: false});
      this.updateValidators();
    }
  }

  writeValue(value: IotSvgObjectSettings): void {
    this.modelValue = value || { behavior: {}, properties: {} };
    this.setupValue();
  }

  validate(c: UntypedFormControl) {
    const valid = this.iotSvgObjectSettingsFormGroup.valid;
    return valid ? null : {
      iotSvgObject: {
        valid: false,
      },
    };
  }

  private loadMetadata() {
    if (this.validatorSubscription) {
      this.validatorSubscription.unsubscribe();
      this.validatorSubscription = null;
    }
    this.validatorTriggers = [];

    let svgContent$: Observable<string>;
    if (this.svgContent) {
      svgContent$ = of(this.svgContent);
    } else if (this.svgUrl) {
      svgContent$ = this.imageService.getImageString(this.svgUrl);
    } else {
      svgContent$ = this.http.get(this.svgPath, {responseType: 'text'});
    }
    svgContent$.subscribe(
      (svgContent) => {
        this.metadata = parseIotSvgMetadataFromContent(svgContent);
        this.propertyRows = toPropertyRows(this.metadata.properties);
        const behaviorFormGroup =  this.iotSvgObjectSettingsFormGroup.get('behavior') as UntypedFormGroup;
        for (const control of Object.keys(behaviorFormGroup.controls)) {
          behaviorFormGroup.removeControl(control, {emitEvent: false});
        }
        const propertiesFormGroup =  this.iotSvgObjectSettingsFormGroup.get('properties') as UntypedFormGroup;
        for (const control of Object.keys(propertiesFormGroup.controls)) {
          propertiesFormGroup.removeControl(control, {emitEvent: false});
        }
        for (const behaviour of this.metadata.behavior) {
          behaviorFormGroup.addControl(behaviour.id, this.fb.control(null, []), {emitEvent: false});
        }
        for (const property of this.metadata.properties) {
          if (property.disableOnProperty) {
            if (!this.validatorTriggers.includes(property.disableOnProperty)) {
              this.validatorTriggers.push(property.disableOnProperty);
            }
          }
          const validators: ValidatorFn[] = [];
          if (property.required) {
            validators.push(Validators.required);
          }
          if (property.type === IotSvgPropertyType.number) {
            if (isDefinedAndNotNull(property.min)) {
              validators.push(Validators.min(property.min));
            }
            if (isDefinedAndNotNull(property.max)) {
              validators.push(Validators.max(property.max));
            }
          }
          propertiesFormGroup.addControl(property.id, this.fb.control(null, validators), {emitEvent: false});
        }
        if (this.validatorTriggers.length) {
          const observables: Observable<any>[] = [];
          for (const trigger of this.validatorTriggers) {
            observables.push(propertiesFormGroup.get(trigger).valueChanges);
          }
          this.validatorSubscription = merge(...observables).subscribe(() => {
            this.updateValidators();
          });
        }
        this.setupValue();
        this.cd.markForCheck();
      }
    );
  }

  private updateValidators() {
    const propertiesFormGroup =  this.iotSvgObjectSettingsFormGroup.get('properties') as UntypedFormGroup;
    for (const trigger of this.validatorTriggers) {
      const value: boolean = propertiesFormGroup.get(trigger).value;
      this.metadata.properties.filter(p => p.disableOnProperty === trigger).forEach(
        (p) => {
          const control = propertiesFormGroup.get(p.id);
          if (value) {
            control.enable({emitEvent: false});
          } else {
            control.disable({emitEvent: false});
          }
        }
      );
    }
  }

  private setupValue() {
    if (this.metadata) {
      const defaults = defaultIotSvgObjectSettings(this.metadata);
      this.modelValue = mergeDeep<IotSvgObjectSettings>(defaults, this.modelValue);
      this.iotSvgObjectSettingsFormGroup.patchValue(
        this.modelValue, {emitEvent: false}
      );
      this.setDisabledState(this.disabled);
    }
  }

  private updateModel() {
    this.modelValue = this.iotSvgObjectSettingsFormGroup.getRawValue();
    this.propagateChange(this.modelValue);
  }
}
